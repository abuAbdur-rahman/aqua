use aqua_daemon::router_with_fs_root;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::json;
use tempfile::tempdir;
use tower::ServiceExt;

#[tokio::test]
async fn layout_is_empty_then_round_trips_through_http() {
    let root = tempdir().expect("temporary root should exist");
    let app = router_with_fs_root(root.path().to_path_buf());

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/state/layout")
                .body(Body::empty())
                .expect("GET request should be valid"),
        )
        .await
        .expect("GET should respond");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .as_ref(),
        br#"{"windows":[],"spaces":[]}"#
    );

    let layout = json!({
        "windows": [{
            "id": "finder-1",
            "app": "finder",
            "spaceId": 1,
            "x": 20,
            "y": 30,
            "w": 900,
            "h": 700,
            "minimized": false,
            "zIndex": 0,
            "appState": {"path": "/home/user"}
        }],
        "spaces": [{"id": 1, "name": "Main", "orderIndex": 0}]
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/state/layout")
                .header("content-type", "application/json")
                .body(Body::from(layout.to_string()))
                .expect("PUT request should be valid"),
        )
        .await
        .expect("PUT should respond");
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/state/layout")
                .body(Body::empty())
                .expect("GET request should be valid"),
        )
        .await
        .expect("GET should respond");
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        layout
    );
}

#[tokio::test]
async fn invalid_layout_does_not_replace_existing_state() {
    let root = tempdir().expect("temporary root should exist");
    let app = router_with_fs_root(root.path().to_path_buf());
    let invalid = json!({
        "windows": [{"id": "window", "app": "finder", "spaceId": 99, "x": 0, "y": 0, "w": 800, "h": 600, "minimized": false, "zIndex": 0, "appState": null}],
        "spaces": []
    });
    let response = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/state/layout")
                .header("content-type", "application/json")
                .body(Body::from(invalid.to_string()))
                .expect("PUT request should be valid"),
        )
        .await
        .expect("PUT should respond");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
