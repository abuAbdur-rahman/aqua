use std::{fs, os::unix::fs::symlink, path::PathBuf};

use aqua_daemon::{router_with_fs_root, router_with_fs_root_and_elevation};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

async fn request(router: axum::Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&body).unwrap())
}

fn json_request(body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/fs/op")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

// A router whose elevation is granted via a fake sudo binary, mirroring the
// phase_7 fake-sudo pattern. Password-gated destructive trash operations
// (permanentDelete, emptyTrash) need this grant to proceed. The returned
// TempDir owns the fake sudo binary and must stay alive for the whole test —
// dropping it deletes the binary and later elevate calls would fail.
fn router_with_password_grant(root: &std::path::Path) -> (axum::Router, TempDir) {
    let tools = TempDir::new().unwrap();
    let sudo = tools.path().join("sudo-fake");
    fs::write(
        &sudo,
        "#!/bin/sh\nif [ \"$1\" = \"-S\" ]; then cat >/dev/null; exit 0; fi\nexit 1\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&sudo, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let helper = PathBuf::from(env!("CARGO_BIN_EXE_aqua-daemon-helper"));
    (
        router_with_fs_root_and_elevation(root.to_path_buf(), sudo, helper),
        tools,
    )
}

#[tokio::test]
async fn trash_round_trip_restores_with_conflict_rename() {
    let root = TempDir::new().unwrap();
    tokio::fs::write(root.path().join("note.txt"), "old")
        .await
        .unwrap();
    let router = router_with_fs_root(root.path().to_path_buf());

    let (status, moved) = request(
        router.clone(),
        json_request(json!({"op": "moveToTrash", "path": "note.txt"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let trash_id = moved["trashId"].as_str().unwrap().to_owned();
    assert!(!root.path().join("note.txt").exists());

    let (status, list) = request(
        router.clone(),
        Request::builder()
            .uri("/api/trash/list")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list[0]["id"], trash_id);
    assert_eq!(
        list[0]["originalPath"],
        root.path().join("note.txt").to_string_lossy().to_string()
    );

    tokio::fs::write(root.path().join("note.txt"), "new")
        .await
        .unwrap();
    let (status, restored) = request(
        router.clone(),
        json_request(json!({"op": "restoreFromTrash", "trashId": trash_id})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(restored, json!({"success": true}));
    assert_eq!(
        tokio::fs::read_to_string(root.path().join("note (1).txt"))
            .await
            .unwrap(),
        "old"
    );
}

#[tokio::test]
async fn copy_preserves_source_and_auto_renames_destination() {
    let root = TempDir::new().unwrap();
    tokio::fs::write(root.path().join("source.txt"), "content")
        .await
        .unwrap();
    tokio::fs::write(root.path().join("copy.txt"), "existing")
        .await
        .unwrap();
    let router = router_with_fs_root(root.path().to_path_buf());

    let (status, body) = request(
        router,
        json_request(json!({"op": "copy", "path": "source.txt", "to": "copy.txt"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"success": true}));
    assert_eq!(
        tokio::fs::read_to_string(root.path().join("source.txt"))
            .await
            .unwrap(),
        "content"
    );
    assert_eq!(
        tokio::fs::read_to_string(root.path().join("copy.txt"))
            .await
            .unwrap(),
        "existing"
    );
    assert_eq!(
        tokio::fs::read_to_string(root.path().join("copy (1).txt"))
            .await
            .unwrap(),
        "content"
    );
}

#[tokio::test]
async fn trash_moves_symlink_without_touching_target() {
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    tokio::fs::write(outside.path().join("target"), "keep")
        .await
        .unwrap();
    symlink(outside.path().join("target"), root.path().join("link")).unwrap();
    let router = router_with_fs_root(root.path().to_path_buf());

    let (status, body) = request(
        router.clone(),
        json_request(json!({"op": "moveToTrash", "path": "link"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["trashId"].is_string());
    assert!(outside.path().join("target").exists());
    assert!(!root.path().join("link").exists());
}

#[tokio::test]
async fn permanent_delete_requires_password_without_elevation() {
    let root = TempDir::new().unwrap();
    tokio::fs::write(root.path().join("guarded.txt"), "guarded")
        .await
        .unwrap();
    let router = router_with_fs_root(root.path().to_path_buf());
    let (_, moved) = request(
        router.clone(),
        json_request(json!({"op":"moveToTrash","path":"guarded.txt"})),
    )
    .await;
    let id = moved["trashId"].as_str().unwrap();

    // No elevation grant: irreversible deletion must be refused even though
    // the trash contents are user-owned.
    let (status, body) = request(
        router.clone(),
        json_request(json!({"op":"permanentDelete","trashId":id})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body,
        json!({"success": false, "error": "elevation is required", "needsElevation": true})
    );
}

#[tokio::test]
async fn permanent_delete_removes_trash_entry() {
    let root = TempDir::new().unwrap();
    tokio::fs::write(root.path().join("remove.txt"), "gone")
        .await
        .unwrap();
    let (router, _tools) = router_with_password_grant(root.path());
    let (_, moved) = request(
        router.clone(),
        json_request(json!({"op":"moveToTrash","path":"remove.txt"})),
    )
    .await;
    let id = moved["trashId"].as_str().unwrap();

    let (status, _) = request(
        router.clone(),
        Request::builder()
            .method("POST")
            .uri("/api/system/elevate")
            .header("content-type", "application/json")
            .body(Body::from(json!({"password": "test-password"}).to_string()))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = request(
        router.clone(),
        json_request(json!({"op":"permanentDelete","trashId":id})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"success": true}));
    let (_, list) = request(
        router,
        Request::builder()
            .uri("/api/trash/list")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert!(list.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn restore_recreates_missing_parent_directories() {
    let root = TempDir::new().unwrap();
    tokio::fs::create_dir_all(root.path().join("nested/parent"))
        .await
        .unwrap();
    tokio::fs::write(root.path().join("nested/parent/note.txt"), "content")
        .await
        .unwrap();
    let router = router_with_fs_root(root.path().to_path_buf());

    let (_, moved) = request(
        router.clone(),
        json_request(json!({"op":"moveToTrash","path":"nested/parent/note.txt"})),
    )
    .await;
    tokio::fs::remove_dir_all(root.path().join("nested"))
        .await
        .unwrap();

    let (status, body) = request(
        router,
        json_request(json!({
            "op":"restoreFromTrash",
            "trashId": moved["trashId"].as_str().unwrap()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"success": true}));
    assert_eq!(
        tokio::fs::read_to_string(root.path().join("nested/parent/note.txt"))
            .await
            .unwrap(),
        "content"
    );
}

#[tokio::test]
async fn empty_trash_removes_every_entry() {
    let root = TempDir::new().unwrap();
    tokio::fs::write(root.path().join("first.txt"), "first")
        .await
        .unwrap();
    tokio::fs::write(root.path().join("second.txt"), "second")
        .await
        .unwrap();
    let (router, _tools) = router_with_password_grant(root.path());

    for path in ["first.txt", "second.txt"] {
        let (status, _) = request(
            router.clone(),
            json_request(json!({"op":"moveToTrash","path":path})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    // Emptying is password-gated too: without a grant it must be refused.
    let (status, body) = request(router.clone(), json_request(json!({"op":"emptyTrash"}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body,
        json!({"success": false, "error": "elevation is required", "needsElevation": true})
    );

    let (status, _) = request(
        router.clone(),
        Request::builder()
            .method("POST")
            .uri("/api/system/elevate")
            .header("content-type", "application/json")
            .body(Body::from(json!({"password": "test-password"}).to_string()))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = request(router.clone(), json_request(json!({"op":"emptyTrash"}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"success": true}));

    let (_, list) = request(
        router,
        Request::builder()
            .uri("/api/trash/list")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert!(list.as_array().unwrap().is_empty());
}
