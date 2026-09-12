use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};

use axum::{
    Json,
    extract::{Query, State},
};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tantivy::{
    Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term,
    collector::TopDocs,
    doc,
    query::QueryParser,
    schema::{Field, STORED, STRING, Schema, TEXT, Value},
};
use tokio::sync::Mutex;
use tracing::{info, warn};
use walkdir::{DirEntry, WalkDir};

use crate::{AppState, fs::ApiError};

const MAX_QUERY_LENGTH: usize = 256;
const MAX_RESULTS: usize = 50;
const MAX_INDEXED_FILE_BYTES: u64 = 512 * 1024;
const MAX_INDEXED_FILES: usize = 10_000;
const MAX_INDEX_DEPTH: usize = 6;
const MAX_SNIPPET_CHARS: usize = 180;
const WRITER_MEMORY_BYTES: usize = 15_000_000;
const WATCH_DEBOUNCE: Duration = Duration::from_millis(250);
const INITIAL_BATCH_SIZE: usize = 128;
const INITIAL_BATCH_PAUSE: Duration = Duration::from_millis(10);

#[derive(Clone)]
pub(crate) struct Manager {
    core: Arc<Mutex<SearchCore>>,
    shutdown: Arc<AtomicBool>,
}

struct SearchCore {
    index: Index,
    reader: IndexReader,
    writer: IndexWriter<TantivyDocument>,
    path: Field,
    name: Field,
    content: Field,
    root: PathBuf,
}

impl Manager {
    pub(crate) fn new(root: PathBuf, start_indexer: bool) -> Self {
        let core = SearchCore::new(root.clone()).expect("in-memory search index must initialize");
        let manager = Self {
            core: Arc::new(Mutex::new(core)),
            shutdown: Arc::new(AtomicBool::new(false)),
        };
        if start_indexer {
            manager.start(root);
        }
        manager
    }

    fn start(&self, root: PathBuf) {
        let roots = search_roots(&root);
        let core = Arc::clone(&self.core);
        let shutdown = Arc::clone(&self.shutdown);
        tokio::task::spawn_blocking(move || {
            if let Err(error) = build_initial_index(&core, &roots, &shutdown) {
                warn!(%error, "Spotlight initial indexing failed");
            }
            if shutdown.load(Ordering::Relaxed) {
                return;
            }
            if let Err(error) = watch_for_changes(core, roots, shutdown) {
                warn!(%error, "Spotlight filesystem watcher stopped");
            }
        });
    }

    pub(crate) fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }
}

impl SearchCore {
    fn new(root: PathBuf) -> tantivy::Result<Self> {
        let mut schema = Schema::builder();
        let path = schema.add_text_field("path", STRING | STORED);
        let name = schema.add_text_field("name", TEXT | STORED);
        let content = schema.add_text_field("content", TEXT | STORED);
        let schema = schema.build();
        let index = Index::create_in_ram(schema);
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()?;
        let writer = index.writer(WRITER_MEMORY_BYTES)?;
        Ok(Self {
            index,
            reader,
            writer,
            path,
            name,
            content,
            root,
        })
    }

    fn upsert(&mut self, path: &Path) -> tantivy::Result<()> {
        let Some(relative) = indexable_relative_path(&self.root, path) else {
            return Ok(());
        };
        let relative = relative.to_string_lossy().into_owned();
        self.writer
            .delete_term(Term::from_field_text(self.path, &relative));
        let Ok(metadata) = path.symlink_metadata() else {
            return Ok(());
        };
        if !metadata.is_file() || metadata.len() > MAX_INDEXED_FILE_BYTES {
            return Ok(());
        }
        let Ok(bytes) = std::fs::read(path) else {
            return Ok(());
        };
        let Ok(content) = String::from_utf8(bytes) else {
            return Ok(());
        };
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        self.writer.add_document(doc!(
            self.path => relative,
            self.name => name,
            self.content => content,
        ))?;
        Ok(())
    }

    fn remove(&mut self, path: &Path) {
        if let Some(relative) = indexable_relative_path(&self.root, path) {
            self.writer.delete_term(Term::from_field_text(
                self.path,
                &relative.to_string_lossy(),
            ));
        }
    }

    fn commit(&mut self) -> tantivy::Result<()> {
        self.writer.commit()?;
        self.reader.reload()
    }
}

#[derive(Deserialize)]
pub(crate) struct SearchQuery {
    q: String,
}

#[derive(Serialize)]
pub(crate) struct SearchResponse {
    files: Vec<SearchFileHit>,
    apps: Vec<SearchAppHit>,
    actions: Vec<SearchActionHit>,
}

#[derive(Serialize)]
struct SearchFileHit {
    path: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    snippet: Option<String>,
    score: f32,
}

#[derive(Serialize)]
struct SearchAppHit {
    id: &'static str,
    name: &'static str,
    icon: &'static str,
}

#[derive(Serialize)]
struct SearchActionHit {
    kind: &'static str,
    input: String,
    result: String,
}

pub(crate) async fn query(
    State(state): State<AppState>,
    Query(params): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, ApiError> {
    let query = params.q.trim();
    if query.len() > MAX_QUERY_LENGTH {
        return Err(ApiError::bad_request("search query is too long"));
    }
    if query.is_empty() {
        return Ok(Json(SearchResponse {
            files: Vec::new(),
            apps: Vec::new(),
            actions: Vec::new(),
        }));
    }

    let core = state.search.core.lock().await;
    let searcher = core.reader.searcher();
    let parser = QueryParser::for_index(&core.index, vec![core.name, core.content]);
    let parsed = parser
        .parse_query(query)
        .map_err(|_| ApiError::bad_request("invalid search query"))?;
    let hits = searcher
        .search(&parsed, &TopDocs::with_limit(MAX_RESULTS))
        .map_err(|_| ApiError::internal("search failed"))?;
    let mut files = Vec::with_capacity(hits.len());
    for (score, address) in hits {
        let document: TantivyDocument = searcher
            .doc(address)
            .map_err(|_| ApiError::internal("search result could not be read"))?;
        let path = text_value(&document, core.path).unwrap_or_default();
        let name = text_value(&document, core.name).unwrap_or_default();
        let content = text_value(&document, core.content);
        files.push(SearchFileHit {
            path,
            name,
            snippet: content.and_then(|content| make_snippet(&content, query)),
            score,
        });
    }

    Ok(Json(SearchResponse {
        files,
        apps: app_hits(query),
        actions: quick_actions(query),
    }))
}

fn search_roots(root: &Path) -> Vec<PathBuf> {
    let mut roots = vec![root.to_path_buf()];
    for name in ["Desktop", "Documents", "Downloads"] {
        let path = root.join(name);
        if path.is_dir() {
            roots.push(path);
        }
    }
    roots
}

fn build_initial_index(
    core: &Arc<Mutex<SearchCore>>,
    roots: &[PathBuf],
    shutdown: &AtomicBool,
) -> tantivy::Result<()> {
    let paths: Vec<_> = roots
        .iter()
        .enumerate()
        .flat_map(|(index, root)| {
            let max_depth = if index == 0 { 1 } else { MAX_INDEX_DEPTH };
            WalkDir::new(root)
                .follow_links(false)
                .max_depth(max_depth)
                .into_iter()
                .filter_entry(should_descend)
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_file())
                .map(DirEntry::into_path)
                .collect::<Vec<_>>()
        })
        .take(MAX_INDEXED_FILES)
        .collect();
    let handle = tokio::runtime::Handle::current();
    for batch in paths.chunks(INITIAL_BATCH_SIZE) {
        if shutdown.load(Ordering::Relaxed) {
            return Ok(());
        }
        let batch = batch.to_vec();
        handle.block_on(async {
            let mut core = core.lock().await;
            for path in batch {
                core.upsert(&path)?;
            }
            core.commit()
        })?;
        std::thread::sleep(INITIAL_BATCH_PAUSE);
    }
    info!(
        indexed_files = paths.len(),
        "Spotlight initial index is ready"
    );
    Ok(())
}

fn watch_for_changes(
    core: Arc<Mutex<SearchCore>>,
    roots: Vec<PathBuf>,
    shutdown: Arc<AtomicBool>,
) -> notify::Result<()> {
    let (sender, receiver) = mpsc::channel();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |event| {
        let _ = sender.send(event);
    })?;
    for (index, root) in roots.into_iter().enumerate() {
        if root.is_dir() {
            let mode = if index == 0 {
                RecursiveMode::NonRecursive
            } else {
                RecursiveMode::Recursive
            };
            watcher.watch(&root, mode)?;
        }
    }
    let handle = tokio::runtime::Handle::current();
    while !shutdown.load(Ordering::Relaxed) {
        let Ok(first) = receiver.recv_timeout(Duration::from_millis(500)) else {
            continue;
        };
        let mut events = vec![first];
        while let Ok(event) = receiver.recv_timeout(WATCH_DEBOUNCE) {
            events.push(event);
        }
        handle.block_on(apply_events(&core, events));
    }
    Ok(())
}

async fn apply_events(core: &Arc<Mutex<SearchCore>>, events: Vec<notify::Result<Event>>) {
    let mut core = core.lock().await;
    for event in events.into_iter().flatten() {
        for path in event.paths {
            match event.kind {
                EventKind::Remove(_) => core.remove(&path),
                EventKind::Create(_) | EventKind::Modify(_) => {
                    if let Err(error) = core.upsert(&path) {
                        warn!(%error, "Spotlight incremental update failed");
                    }
                }
                _ => {}
            }
        }
    }
    if let Err(error) = core.commit() {
        warn!(%error, "Spotlight incremental commit failed");
    }
}

fn should_descend(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    !entry.file_type().is_symlink()
        && !matches!(
            entry.file_name().to_string_lossy().as_ref(),
            ".git"
                | ".cache"
                | ".local"
                | ".npm"
                | ".cargo"
                | ".rustup"
                | "node_modules"
                | "target"
        )
}

fn indexable_relative_path<'a>(root: &'a Path, path: &'a Path) -> Option<&'a Path> {
    let relative = path.strip_prefix(root).ok()?;
    if relative.components().any(|component| {
        matches!(
            component.as_os_str().to_string_lossy().as_ref(),
            ".git"
                | ".cache"
                | ".local"
                | ".npm"
                | ".cargo"
                | ".rustup"
                | "node_modules"
                | "target"
        )
    }) {
        return None;
    }
    Some(relative)
}

fn text_value(document: &TantivyDocument, field: Field) -> Option<String> {
    document
        .get_first(field)
        .and_then(|value| value.as_str())
        .map(str::to_owned)
}

fn make_snippet(content: &str, query: &str) -> Option<String> {
    let lower = content.to_lowercase();
    let position = lower.find(&query.to_lowercase())?;
    let char_position = content[..position].chars().count();
    let before = char_position.saturating_sub(MAX_SNIPPET_CHARS / 3);
    Some(
        content
            .chars()
            .skip(before)
            .take(MAX_SNIPPET_CHARS)
            .collect(),
    )
}

fn app_hits(query: &str) -> Vec<SearchAppHit> {
    const APPS: [SearchAppHit; 4] = [
        SearchAppHit {
            id: "finder",
            name: "Finder",
            icon: "finder",
        },
        SearchAppHit {
            id: "terminal",
            name: "Terminal",
            icon: "terminal",
        },
        SearchAppHit {
            id: "editor",
            name: "Editor",
            icon: "editor",
        },
        SearchAppHit {
            id: "activity-monitor",
            name: "Activity Monitor",
            icon: "activity-monitor",
        },
    ];
    let query = query.to_lowercase();
    APPS.into_iter()
        .filter(|app| app.name.to_lowercase().contains(&query))
        .collect()
}

fn quick_actions(query: &str) -> Vec<SearchActionHit> {
    calculate(query)
        .or_else(|| convert_units(query))
        .into_iter()
        .collect()
}

fn calculate(input: &str) -> Option<SearchActionHit> {
    for operator in ['+', '-', '*', '/'] {
        let Some((left, right)) = input.split_once(operator) else {
            continue;
        };
        let Ok(left) = left.trim().parse::<f64>() else {
            continue;
        };
        let Ok(right) = right.trim().parse::<f64>() else {
            continue;
        };
        let result = match operator {
            '+' => left + right,
            '-' => left - right,
            '*' => left * right,
            '/' if right != 0.0 => left / right,
            _ => return None,
        };
        return Some(SearchActionHit {
            kind: "calculator",
            input: input.to_owned(),
            result: format_number(result),
        });
    }
    None
}

fn convert_units(input: &str) -> Option<SearchActionHit> {
    let normalized = input.to_lowercase().replace(" to ", " ");
    let parts: Vec<_> = normalized.split_whitespace().collect();
    if parts.len() != 3 {
        return None;
    }
    let value = parts[0].parse::<f64>().ok()?;
    let result = match (parts[1], parts[2]) {
        ("km", "mi") => value * 0.621_371,
        ("mi", "km") => value / 0.621_371,
        ("kg", "lb") => value * 2.204_622_621_8,
        ("lb", "kg") => value / 2.204_622_621_8,
        ("c", "f") => value * 9.0 / 5.0 + 32.0,
        ("f", "c") => (value - 32.0) * 5.0 / 9.0,
        _ => return None,
    };
    Some(SearchActionHit {
        kind: "unitConvert",
        input: input.to_owned(),
        result: format!("{} {}", format_number(result), parts[2]),
    })
}

fn format_number(value: f64) -> String {
    let value = format!("{value:.6}");
    value.trim_end_matches('0').trim_end_matches('.').to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn matching_paths(core: &SearchCore, query: &str) -> Vec<String> {
        let searcher = core.reader.searcher();
        let parser = QueryParser::for_index(&core.index, vec![core.name, core.content]);
        let query = parser.parse_query(query).expect("test query should parse");
        searcher
            .search(&query, &TopDocs::with_limit(MAX_RESULTS))
            .expect("test search should succeed")
            .into_iter()
            .map(|(_, address)| {
                let document: TantivyDocument = searcher.doc(address).expect("document exists");
                text_value(&document, core.path).expect("path is stored")
            })
            .collect()
    }

    #[tokio::test]
    async fn startup_index_searches_names_and_text_and_excludes_cache_paths() {
        let directory = tempdir().expect("temporary directory should be created");
        fs::create_dir(directory.path().join(".git")).expect("excluded directory should exist");
        fs::create_dir(directory.path().join("Desktop")).expect("search root should exist");
        fs::write(directory.path().join("visible.txt"), "meeting notes").expect("file writes");
        fs::write(directory.path().join("Desktop/project.md"), "meeting plan")
            .expect("file writes");
        fs::write(directory.path().join(".git/hidden.txt"), "meeting secret").expect("file writes");

        let core = Arc::new(Mutex::new(
            SearchCore::new(directory.path().to_path_buf()).unwrap(),
        ));
        let core_for_index = Arc::clone(&core);
        let roots = search_roots(directory.path());
        tokio::task::spawn_blocking(move || {
            build_initial_index(&core_for_index, &roots, &AtomicBool::new(false))
        })
        .await
        .expect("indexing task should finish")
        .expect("indexing should succeed");
        let core = core.lock().await;
        let paths = matching_paths(&core, "meeting");

        assert!(paths.iter().any(|path| path.ends_with("visible.txt")));
        assert!(paths.iter().any(|path| path.ends_with("project.md")));
        assert!(!paths.iter().any(|path| path.contains(".git")));
    }

    #[tokio::test]
    async fn incremental_events_update_modify_rename_and_delete() {
        let directory = tempdir().expect("temporary directory should be created");
        let path = directory.path().join("item.txt");
        fs::write(&path, "old value").expect("file writes");
        let core = Arc::new(Mutex::new(
            SearchCore::new(directory.path().to_path_buf()).unwrap(),
        ));
        let core_for_index = Arc::clone(&core);
        let index_root = directory.path().to_path_buf();
        tokio::task::spawn_blocking(move || {
            build_initial_index(&core_for_index, &[index_root], &AtomicBool::new(false))
        })
        .await
        .expect("indexing task should finish")
        .expect("indexing should succeed");

        fs::write(&path, "new value").expect("file writes");
        apply_events(
            &core,
            vec![Ok(Event::new(EventKind::Modify(
                notify::event::ModifyKind::Any,
            ))
            .add_path(path.clone()))],
        )
        .await;
        {
            let core = core.lock().await;
            assert!(
                matching_paths(&core, "new")
                    .iter()
                    .any(|item| item.ends_with("item.txt"))
            );
            assert!(matching_paths(&core, "old").is_empty());
        }

        let renamed = directory.path().join("renamed.txt");
        fs::rename(&path, &renamed).expect("file rename");
        apply_events(
            &core,
            vec![
                Ok(Event::new(EventKind::Remove(notify::event::RemoveKind::Any)).add_path(path)),
                Ok(
                    Event::new(EventKind::Create(notify::event::CreateKind::Any))
                        .add_path(renamed.clone()),
                ),
            ],
        )
        .await;
        {
            let core = core.lock().await;
            let paths = matching_paths(&core, "new");
            assert!(!paths.iter().any(|item| item.ends_with("item.txt")));
            assert!(paths.iter().any(|item| item.ends_with("renamed.txt")));
        }

        fs::remove_file(&renamed).expect("file delete");
        apply_events(
            &core,
            vec![Ok(Event::new(EventKind::Remove(
                notify::event::RemoveKind::Any,
            ))
            .add_path(renamed))],
        )
        .await;
        let core = core.lock().await;
        assert!(matching_paths(&core, "new").is_empty());
    }

    #[tokio::test]
    async fn discarded_in_memory_index_recovers_by_reindexing_files() {
        let directory = tempdir().expect("temporary directory should be created");
        fs::write(directory.path().join("recover.txt"), "recoverable").expect("file writes");
        let initial = SearchCore::new(directory.path().to_path_buf()).unwrap();
        drop(initial);
        let core = Arc::new(Mutex::new(
            SearchCore::new(directory.path().to_path_buf()).unwrap(),
        ));
        let core_for_index = Arc::clone(&core);
        tokio::task::spawn_blocking(move || {
            build_initial_index(
                &core_for_index,
                &[directory.path().to_path_buf()],
                &AtomicBool::new(false),
            )
        })
        .await
        .expect("indexing task should finish")
        .expect("reindex should succeed");
        let core = core.lock().await;
        assert!(
            matching_paths(&core, "recoverable")
                .iter()
                .any(|path| path.ends_with("recover.txt"))
        );
    }

    #[test]
    fn snippets_support_non_ascii_matches() {
        assert_eq!(
            make_snippet("café résumé", "résumé"),
            Some("café résumé".to_owned())
        );
    }

    #[test]
    fn quick_actions_cover_calculation_and_unit_conversion() {
        assert_eq!(calculate("12 + 30").unwrap().result, "42");
        assert_eq!(convert_units("10 km to mi").unwrap().kind, "unitConvert");
        assert!(calculate("10 / 0").is_none());
        assert!(convert_units("10 meters to miles").is_none());
    }
}
