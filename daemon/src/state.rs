use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

const SCHEMA_VERSION: i32 = 1;
const DEFAULT_DB_DIR: &str = ".local/share/aqua";
const DEFAULT_DB_FILE: &str = "state.sqlite3";

#[derive(Clone)]
pub(crate) struct Store {
    connection: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LayoutState {
    pub(crate) windows: Vec<WindowState>,
    pub(crate) spaces: Vec<SpaceState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WindowState {
    pub(crate) id: String,
    pub(crate) app: String,
    pub(crate) space_id: i64,
    pub(crate) x: i64,
    pub(crate) y: i64,
    pub(crate) w: i64,
    pub(crate) h: i64,
    pub(crate) minimized: bool,
    pub(crate) z_index: i64,
    pub(crate) app_state: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpaceState {
    pub(crate) id: i64,
    pub(crate) name: String,
    pub(crate) order_index: i64,
}

#[derive(Debug)]
pub(crate) enum StateError {
    Invalid(String),
    Storage(String),
}

impl Store {
    pub(crate) fn open_default(home: &Path) -> Result<Self, StateError> {
        let path = home.join(DEFAULT_DB_DIR).join(DEFAULT_DB_FILE);
        Self::open(path)
    }

    pub(crate) fn in_memory() -> Result<Self, StateError> {
        let connection = Connection::open_in_memory().map_err(|error| {
            StateError::Storage(format!("open in-memory state database: {error}"))
        })?;
        Self::initialize(connection)
    }

    pub(crate) fn open(path: PathBuf) -> Result<Self, StateError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| StateError::Storage(format!("create state directory: {error}")))?;
        }
        let connection = Connection::open(path)
            .map_err(|error| StateError::Storage(format!("open state database: {error}")))?;
        Self::initialize(connection)
    }

    fn initialize(connection: Connection) -> Result<Self, StateError> {
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|error| StateError::Storage(format!("enable foreign keys: {error}")))?;
        migrate(&connection)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub(crate) fn get_layout(&self) -> Result<LayoutState, StateError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StateError::Storage("state lock poisoned".into()))?;
        let mut spaces_statement = connection
            .prepare("SELECT id, name, order_index FROM spaces ORDER BY order_index, id")
            .map_err(storage)?;
        let spaces = spaces_statement
            .query_map([], |row| {
                Ok(SpaceState {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    order_index: row.get(2)?,
                })
            })
            .map_err(storage)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage)?;

        let mut windows_statement = connection
            .prepare("SELECT id, app, space_id, x, y, w, h, minimized, z_index, app_state FROM windows ORDER BY z_index, id")
            .map_err(storage)?;
        let windows = windows_statement
            .query_map([], |row| {
                let app_state: String = row.get(9)?;
                Ok(WindowState {
                    id: row.get(0)?,
                    app: row.get(1)?,
                    space_id: row.get(2)?,
                    x: row.get(3)?,
                    y: row.get(4)?,
                    w: row.get(5)?,
                    h: row.get(6)?,
                    minimized: row.get::<_, i64>(7)? != 0,
                    z_index: row.get(8)?,
                    app_state: serde_json::from_str(&app_state).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            9,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                })
            })
            .map_err(storage)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage)?;

        Ok(LayoutState { windows, spaces })
    }

    pub(crate) fn replace_layout(&self, layout: &LayoutState) -> Result<(), StateError> {
        validate_layout(layout)?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StateError::Storage("state lock poisoned".into()))?;
        let transaction = connection.transaction().map_err(storage)?;
        transaction
            .execute("DELETE FROM windows", [])
            .map_err(storage)?;
        transaction
            .execute("DELETE FROM spaces", [])
            .map_err(storage)?;
        for space in &layout.spaces {
            transaction
                .execute(
                    "INSERT INTO spaces (id, name, order_index) VALUES (?1, ?2, ?3)",
                    params![space.id, space.name, space.order_index],
                )
                .map_err(storage)?;
        }
        for window in &layout.windows {
            transaction.execute(
                "INSERT INTO windows (id, app, space_id, x, y, w, h, minimized, z_index, app_state) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![window.id, window.app, window.space_id, window.x, window.y, window.w, window.h, if window.minimized { 1 } else { 0 }, window.z_index, serde_json::to_string(&window.app_state).map_err(|error| StateError::Invalid(format!("appState is not serializable: {error}")))?],
            ).map_err(storage)?;
        }
        transaction.commit().map_err(storage)
    }
}

fn migrate(connection: &Connection) -> Result<(), StateError> {
    let version: i32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(storage)?;
    if version > SCHEMA_VERSION {
        return Err(StateError::Storage(format!(
            "unsupported state schema version {version}"
        )));
    }
    if version == 0 {
        connection.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS spaces (id INTEGER PRIMARY KEY, name TEXT NOT NULL, order_index INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS windows (id TEXT PRIMARY KEY, app TEXT NOT NULL, space_id INTEGER NOT NULL REFERENCES spaces(id), x INTEGER NOT NULL, y INTEGER NOT NULL, w INTEGER NOT NULL, h INTEGER NOT NULL, minimized INTEGER NOT NULL, z_index INTEGER NOT NULL, app_state TEXT NOT NULL);
             PRAGMA user_version = 1;
             COMMIT;",
        ).map_err(storage)?;
    }
    Ok(())
}

fn validate_layout(layout: &LayoutState) -> Result<(), StateError> {
    let mut space_ids = std::collections::HashSet::new();
    for space in &layout.spaces {
        if space.name.trim().is_empty() || !space_ids.insert(space.id) {
            return Err(StateError::Invalid(
                "spaces must have unique non-empty IDs and names".into(),
            ));
        }
    }
    let mut window_ids = std::collections::HashSet::new();
    for window in &layout.windows {
        if window.id.trim().is_empty() || !window_ids.insert(&window.id) {
            return Err(StateError::Invalid(
                "windows must have unique non-empty IDs".into(),
            ));
        }
        if !space_ids.contains(&window.space_id) {
            return Err(StateError::Invalid(format!(
                "window references missing space {}",
                window.space_id
            )));
        }
        if window.w <= 0 || window.h <= 0 {
            return Err(StateError::Invalid(
                "window dimensions must be positive".into(),
            ));
        }
        if window.app.trim().is_empty() {
            return Err(StateError::Invalid("window app must not be empty".into()));
        }
    }
    Ok(())
}

fn storage(error: rusqlite::Error) -> StateError {
    StateError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> LayoutState {
        LayoutState {
            spaces: vec![SpaceState {
                id: 1,
                name: "Main".into(),
                order_index: 0,
            }],
            windows: vec![WindowState {
                id: "finder-1".into(),
                app: "finder".into(),
                space_id: 1,
                x: 10,
                y: 20,
                w: 800,
                h: 600,
                minimized: false,
                z_index: 0,
                app_state: serde_json::json!({"path":"/home"}),
            }],
        }
    }

    #[test]
    fn layout_round_trips() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path().join("state.sqlite3")).unwrap();
        let expected = layout();
        store.replace_layout(&expected).unwrap();
        assert_eq!(store.get_layout().unwrap(), expected);
    }

    #[test]
    fn invalid_reference_is_rejected_before_write() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path().join("state.sqlite3")).unwrap();
        let mut invalid = layout();
        invalid.windows[0].space_id = 2;
        assert!(matches!(
            store.replace_layout(&invalid),
            Err(StateError::Invalid(_))
        ));
    }

    #[test]
    fn fresh_database_is_empty() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path().join("state.sqlite3")).unwrap();
        assert_eq!(
            store.get_layout().unwrap(),
            LayoutState {
                windows: vec![],
                spaces: vec![]
            }
        );
    }

    #[test]
    fn future_schema_version_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        drop(connection);
        assert!(
            matches!(Store::open(path), Err(StateError::Storage(message)) if message.contains("unsupported state schema version"))
        );
    }

    #[test]
    fn corrupt_database_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.sqlite3");
        std::fs::write(&path, b"not a sqlite database").unwrap();
        assert!(matches!(Store::open(path), Err(StateError::Storage(_))));
    }

    #[test]
    fn migration_is_repeatable() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.sqlite3");
        Store::open(path.clone()).unwrap();
        Store::open(path).unwrap();
    }
}
