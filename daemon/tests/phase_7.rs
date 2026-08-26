use std::{fs, io, os::unix::fs::PermissionsExt, path::PathBuf};

use aqua_daemon::{router_with_fs_root, router_with_fs_root_and_elevation};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::json;
use tempfile::tempdir;
use tower::ServiceExt;

#[tokio::test]
async fn elevated_operation_requires_cached_elevation() {
    let root = tempdir().expect("temporary root should exist");
    let app = router_with_fs_root(root.path().to_path_buf());
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/fs/op")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "op": "createFile",
                        "path": "protected.txt",
                        "elevated": true
                    })
                    .to_string(),
                ))
                .expect("request should be valid"),
        )
        .await
        .expect("request should respond");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        json!({"success": false, "error": "elevation is required", "needsElevation": true})
    );
}

#[tokio::test]
async fn fake_sudo_elevation_invokes_shared_helper() {
    let root = tempdir().expect("temporary root should exist");
    let tools = tempdir().expect("temporary tool directory should exist");
    let sudo = tools.path().join("sudo-fake");
    fs::write(&sudo, "#!/bin/sh\nif [ \"$1\" = \"-S\" ]; then cat >/dev/null; exit 0; fi\nif [ \"$1\" = \"-n\" ]; then shift; exec \"$@\"; fi\nexit 1\n").unwrap();
    fs::set_permissions(&sudo, fs::Permissions::from_mode(0o700)).unwrap();
    let helper = PathBuf::from(env!("CARGO_BIN_EXE_aqua-daemon-helper"));
    let app = router_with_fs_root_and_elevation(root.path().to_path_buf(), sudo, helper);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/system/elevate")
                .header("content-type", "application/json")
                .body(Body::from(json!({"password": "test-password"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let value: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(value.get("success"), Some(&json!(true)));
    assert!(value.get("expiresAt").is_some());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/fs/op")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "op": "createFile",
                        "path": "elevated.txt",
                        "elevated": true
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(root.path().join("elevated.txt").exists());
}

#[tokio::test]
async fn elevate_rejects_invalid_password_without_sudo() {
    let root = tempdir().expect("temporary root should exist");
    let app = router_with_fs_root(root.path().to_path_buf());
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/system/elevate")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"password": "definitely-invalid"}).to_string(),
                ))
                .expect("request should be valid"),
        )
        .await
        .expect("request should respond");
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value.get("success"), Some(&json!(false)));
}

#[tokio::test]
async fn helper_rejects_symlink_swapped_before_elevated_retry() {
    let root = tempdir().expect("temporary root should exist");
    let outside = tempdir().expect("outside directory should exist");
    let tools = tempdir().expect("temporary tool directory should exist");
    fs::write(
        tools.path().join("sudo-fake"),
        "#!/bin/sh\ncat >/dev/null; exit 0\n",
    )
    .unwrap();
    fs::set_permissions(
        tools.path().join("sudo-fake"),
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();

    let target_dir = outside.path().join("victim");
    fs::create_dir(&target_dir).unwrap();
    let symlink = root.path().join("link");
    std::os::unix::fs::symlink(&target_dir, &symlink).unwrap();

    let helper = PathBuf::from(env!("CARGO_BIN_EXE_aqua-daemon-helper"));
    let request = json!({
        "operation": {"op": "chmod", "path": "link", "mode": "700", "elevated": true},
        "allowedRoot": root.path(),
    });

    // The helper must refuse to traverse the symlink into the victim tree.
    let output = std::process::Command::new(&helper)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write as _;
            child
                .stdin
                .take()
                .ok_or_else(|| io::Error::other("no stdin"))?
                .write_all(request.to_string().as_bytes())?;
            child.wait_with_output()
        })
        .expect("helper should run");
    assert!(
        !output.status.success(),
        "helper must reject symlink escape"
    );
    assert!(target_dir.exists(), "victim directory must survive");
}

#[tokio::test]
async fn expired_cache_returns_needs_elevation_again() {
    // A router whose elevation cache is never granted behaves like an expired one:
    // an elevated op without a prior successful elevate returns needsElevation.
    let root = tempdir().expect("temporary root should exist");
    let app = router_with_fs_root(root.path().to_path_buf());
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/fs/op")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"op": "chmod", "path": "x", "mode": "600", "elevated": true})
                        .to_string(),
                ))
                .expect("request should be valid"),
        )
        .await
        .expect("request should respond");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
