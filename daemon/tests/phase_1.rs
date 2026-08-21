use std::{
    os::unix::fs::{PermissionsExt, symlink},
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use aqua_daemon::router_with_fs_root;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

async fn request_router(router: axum::Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router
        .oneshot(request)
        .await
        .expect("filesystem handler should respond");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body should be readable")
        .to_bytes();
    let body = serde_json::from_slice(&bytes).expect("body should be JSON");
    (status, body)
}

async fn request(root: &Path, request: Request<Body>) -> (StatusCode, Value) {
    request_router(router_with_fs_root(root.to_path_buf()), request).await
}

fn json_request(method: &str, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request should be valid")
}

#[tokio::test]
async fn list_classifies_and_sorts_entries() {
    let root = TempDir::new().expect("temporary root should exist");
    tokio::fs::write(root.path().join("alpha.txt"), "hello")
        .await
        .unwrap();
    tokio::fs::create_dir(root.path().join("bravo"))
        .await
        .unwrap();
    symlink(
        root.path().join("alpha.txt"),
        root.path().join("charlie-link"),
    )
    .unwrap();

    let (status, body) = request(
        root.path(),
        Request::builder()
            .uri("/api/fs/list?path=.")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body.as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["alpha.txt", "bravo", "charlie-link"]
    );
    assert_eq!(body[0]["kind"], "file");
    assert_eq!(body[0]["size"], 5);
    assert_eq!(body[1]["kind"], "dir");
    assert_eq!(body[2]["kind"], "symlink");
    assert!(body[0]["modified"].as_str().unwrap().ends_with('Z'));
    assert!(!body[0]["permissions"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn read_supports_utf8_binary_empty_and_truncation() {
    let root = TempDir::new().unwrap();
    tokio::fs::write(root.path().join("text"), "Aqua")
        .await
        .unwrap();
    tokio::fs::write(root.path().join("binary"), [0xff, 0x00])
        .await
        .unwrap();
    tokio::fs::write(root.path().join("empty"), [])
        .await
        .unwrap();
    tokio::fs::write(root.path().join("large"), vec![b'x'; 1024 * 1024 + 1])
        .await
        .unwrap();
    let mut late_binary = vec![b'x'; 1024 * 1024];
    late_binary.push(0xff);
    tokio::fs::write(root.path().join("late-binary"), late_binary)
        .await
        .unwrap();

    let (_, text) = request(
        root.path(),
        Request::builder()
            .uri("/api/fs/read?path=text")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(
        text,
        json!({"path": root.path().join("text"), "content": "Aqua", "encoding": "utf8", "truncated": false})
    );
    let (_, binary) = request(
        root.path(),
        Request::builder()
            .uri("/api/fs/read?path=binary")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(binary["encoding"], "base64");
    assert_eq!(binary["content"], "/wA=");
    let (_, empty) = request(
        root.path(),
        Request::builder()
            .uri("/api/fs/read?path=empty")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(empty["content"], "");
    let (_, large) = request(
        root.path(),
        Request::builder()
            .uri("/api/fs/read?path=large")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(large["encoding"], "base64");
    assert_eq!(large["truncated"], true);
    assert_eq!(large["content"].as_str().unwrap().len(), 1_398_104);
    let (_, late_binary) = request(
        root.path(),
        Request::builder()
            .uri("/api/fs/read?path=late-binary")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(late_binary["encoding"], "base64");
    assert_eq!(late_binary["truncated"], true);
}

#[tokio::test]
async fn permission_denied_reads_return_a_structured_error() {
    let root = TempDir::new().unwrap();
    let file = root.path().join("restricted");
    tokio::fs::write(&file, "private").await.unwrap();
    tokio::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o000))
        .await
        .unwrap();

    let (status, body) = request(
        root.path(),
        Request::builder()
            .uri("/api/fs/read?path=restricted")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    tokio::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600))
        .await
        .unwrap();

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(
        body["error"]
            .as_str()
            .is_some_and(|message| !message.is_empty())
    );
}

#[tokio::test]
async fn traversal_and_symlink_escape_are_rejected() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    tokio::fs::write(outside.path().join("secret"), "nope")
        .await
        .unwrap();
    symlink(outside.path(), root.path().join("escape")).unwrap();

    let (traversal_status, _) = request(
        root.path(),
        Request::builder()
            .uri("/api/fs/read?path=../secret")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(traversal_status, StatusCode::FORBIDDEN);
    let (escape_status, _) = request(
        root.path(),
        Request::builder()
            .uri("/api/fs/read?path=escape/secret")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(escape_status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mutation_union_and_write_follow_the_contract() {
    let root = TempDir::new().unwrap();
    let (create_status, create) = request(
        root.path(),
        json_request(
            "POST",
            "/api/fs/op",
            json!({"op": "createFile", "path": "note.txt"}),
        ),
    )
    .await;
    assert_eq!(create_status, StatusCode::OK);
    assert_eq!(create, json!({"success": true}));

    let (write_status, write) = request(
        root.path(),
        json_request(
            "PUT",
            "/api/fs/write",
            json!({"path": "note.txt", "content": "saved"}),
        ),
    )
    .await;
    assert_eq!(write_status, StatusCode::OK);
    assert_eq!(write["success"], true);
    assert!(write["modified"].as_str().unwrap().ends_with('Z'));

    let (_, rename) = request(
        root.path(),
        json_request(
            "POST",
            "/api/fs/op",
            json!({"op": "rename", "path": "note.txt", "newName": "renamed.txt"}),
        ),
    )
    .await;
    assert_eq!(rename, json!({"success": true}));
    assert_eq!(
        tokio::fs::read_to_string(root.path().join("renamed.txt"))
            .await
            .unwrap(),
        "saved"
    );

    let (_, chmod) = request(
        root.path(),
        json_request(
            "POST",
            "/api/fs/op",
            json!({"op": "chmod", "path": "renamed.txt", "mode": "600"}),
        ),
    )
    .await;
    assert_eq!(chmod, json!({"success": true}));

    let (_, directory) = request(
        root.path(),
        json_request(
            "POST",
            "/api/fs/op",
            json!({"op": "createDir", "path": "folder"}),
        ),
    )
    .await;
    assert_eq!(directory, json!({"success": true}));
    let (_, moved) = request(
        root.path(),
        json_request(
            "POST",
            "/api/fs/op",
            json!({"op": "move", "path": "renamed.txt", "to": "folder/renamed.txt"}),
        ),
    )
    .await;
    assert_eq!(moved, json!({"success": true}));
    let (_, deleted) = request(
        root.path(),
        json_request(
            "POST",
            "/api/fs/op",
            json!({"op": "delete", "path": "folder"}),
        ),
    )
    .await;
    assert_eq!(deleted, json!({"success": true}));
    assert!(!root.path().join("folder").exists());
}

#[tokio::test]
async fn deleting_a_symlink_does_not_delete_its_target() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let target = outside.path().join("target.txt");
    tokio::fs::write(&target, "keep").await.unwrap();
    std::os::unix::fs::symlink(&target, root.path().join("link.txt")).unwrap();

    let (_, deleted) = request(
        root.path(),
        json_request(
            "POST",
            "/api/fs/op",
            json!({"op": "delete", "path": "link.txt"}),
        ),
    )
    .await;
    assert_eq!(deleted, json!({"success": true}));
    assert!(target.exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_path_replacement_cannot_escape_the_root() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let inside = root.path().join("inside");
    let outside_file = outside.path().join("target");
    std::fs::create_dir(&inside).unwrap();
    std::fs::write(inside.join("target"), "inside").unwrap();
    std::fs::write(&outside_file, "outside").unwrap();
    let outside_mode = std::fs::metadata(&outside_file)
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    let router = router_with_fs_root(root.path().to_path_buf());

    let running = Arc::new(AtomicBool::new(true));
    let swap_running = Arc::clone(&running);
    let root_path = root.path().to_path_buf();
    let outside_path = outside.path().to_path_buf();
    let swapper = std::thread::spawn(move || {
        while swap_running.load(Ordering::Relaxed) {
            let inside = root_path.join("inside");
            let parked = root_path.join("parked");
            if std::fs::rename(&inside, &parked).is_ok() {
                let _ = symlink(&outside_path, &inside);
                std::thread::yield_now();
                let _ = std::fs::remove_file(&inside);
                let _ = std::fs::rename(&parked, &inside);
            }
        }
        let _ = std::fs::remove_file(root_path.join("inside"));
        let _ = std::fs::rename(root_path.join("parked"), root_path.join("inside"));
    });

    for index in 0..300 {
        let requests = [
            Request::builder()
                .uri("/api/fs/read?path=inside/target")
                .body(Body::empty())
                .unwrap(),
            Request::builder()
                .uri("/api/fs/list?path=inside")
                .body(Body::empty())
                .unwrap(),
            json_request(
                "PUT",
                "/api/fs/write",
                json!({"path": "inside/target", "content": "changed"}),
            ),
            json_request(
                "POST",
                "/api/fs/op",
                json!({"op": "createFile", "path": format!("inside/new-{index}")}),
            ),
            json_request(
                "POST",
                "/api/fs/op",
                json!({"op": "chmod", "path": "inside/target", "mode": "600"}),
            ),
            json_request(
                "POST",
                "/api/fs/op",
                json!({"op": "rename", "path": "inside/target", "newName": "renamed"}),
            ),
            json_request(
                "POST",
                "/api/fs/op",
                json!({"op": "move", "path": "inside/target", "to": "inside/moved"}),
            ),
            json_request(
                "POST",
                "/api/fs/op",
                json!({"op": "delete", "path": "inside/target"}),
            ),
        ];
        for request in requests {
            let (_, body) = request_router(router.clone(), request).await;
            if let Some(content) = body.get("content").and_then(Value::as_str) {
                assert_ne!(content, "outside");
            }
        }
    }

    running.store(false, Ordering::Relaxed);
    swapper.join().unwrap();
    assert_eq!(std::fs::read_to_string(&outside_file).unwrap(), "outside");
    assert_eq!(
        std::fs::metadata(&outside_file)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        outside_mode
    );
    assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 1);
    assert!(!outside.path().join("renamed").exists());
    assert!(!outside.path().join("moved").exists());
}

#[tokio::test]
async fn collisions_invalid_names_and_root_mutation_fail_safely() {
    let root = TempDir::new().unwrap();
    tokio::fs::write(root.path().join("taken"), "x")
        .await
        .unwrap();
    let (collision, body) = request(
        root.path(),
        json_request(
            "POST",
            "/api/fs/op",
            json!({"op": "createFile", "path": "taken"}),
        ),
    )
    .await;
    assert_eq!(collision, StatusCode::CONFLICT);
    assert_eq!(body["success"], false);

    let (bad_name, _) = request(
        root.path(),
        json_request(
            "POST",
            "/api/fs/op",
            json!({"op": "rename", "path": "taken", "newName": "../escape"}),
        ),
    )
    .await;
    assert_eq!(bad_name, StatusCode::BAD_REQUEST);
    let (root_delete, _) = request(
        root.path(),
        json_request("POST", "/api/fs/op", json!({"op": "delete", "path": "."})),
    )
    .await;
    assert_eq!(root_delete, StatusCode::FORBIDDEN);
}
