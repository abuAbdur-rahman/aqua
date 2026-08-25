use aqua_daemon::router_with_fs_root;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::tempdir;
use tower::ServiceExt;

fn png_bytes(color: [u8; 3]) -> Vec<u8> {
    let image = image::RgbImage::from_fn(64, 32, |_x, _y| image::Rgb(color));
    let mut buffer = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image)
        .write_to(&mut buffer, image::ImageFormat::Png)
        .expect("png encoding should work");
    buffer.into_inner()
}

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).expect("response should be JSON")
}

#[tokio::test]
async fn wallpaper_upload_round_trips_assets_and_delete() {
    let root = tempdir().expect("temporary root should exist");
    let app = router_with_fs_root(root.path().to_path_buf());

    // Upload a custom wallpaper.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/wallpaper/upload?label=Smoke%20Wall")
                .header("content-type", "image/png")
                .body(Body::from(png_bytes([10, 20, 30])))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let uploaded = body_json(response).await;
    assert_eq!(uploaded["label"], json!("Smoke Wall"));
    let id = uploaded["id"]
        .as_str()
        .expect("id should be a string")
        .to_owned();

    // State lists it and defaults to the built-in selection.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/wallpaper")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let listed = body_json(response).await;
    assert_eq!(listed["current"], json!("aqua"));
    assert_eq!(
        listed["custom"].as_array().map(|items| items.len()),
        Some(1)
    );
    assert_eq!(listed["custom"][0]["id"], json!(id));

    // Full-res asset matches the original bytes; thumbnail is a real PNG.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/wallpaper/asset/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/png");
    let original = response.into_body().collect().await.unwrap().to_bytes();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/wallpaper/asset/{id}/thumb"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.headers()["content-type"], "image/png");
    let thumb = response.into_body().collect().await.unwrap().to_bytes();
    assert_ne!(original.as_ref(), thumb.as_ref());
    assert_eq!(&thumb[..8], b"\x89PNG\r\n\x1a\n");

    // Select it, then delete it: selection must fall back to the built-in.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/wallpaper")
                .header("content-type", "application/json")
                .body(Body::from(json!({"id": id}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/wallpaper")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(body_json(response).await["current"], json!(id));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/wallpaper/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/wallpaper")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let after = body_json(response).await;
    assert_eq!(after["current"], json!("aqua"));
    assert_eq!(after["custom"].as_array().map(|items| items.len()), Some(0));

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/wallpaper/asset/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn deleting_unknown_or_builtin_id_fails() {
    let root = tempdir().expect("temporary root should exist");
    let app = router_with_fs_root(root.path().to_path_buf());
    for id in ["not-a-real-id", "aqua"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/wallpaper/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let value = body_json(response).await;
        assert_eq!(
            value["success"],
            json!(false),
            "deleting '{id}' should fail"
        );
    }
}

#[tokio::test]
async fn wallpaper_delete_preflight_is_allowed_for_tauri_origin() {
    let root = tempdir().expect("temporary root should exist");
    let response = router_with_fs_root(root.path().to_path_buf())
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/wallpaper/test-id")
                .header("origin", "http://tauri.localhost")
                .header("access-control-request-method", "DELETE")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(response.status().is_success());
    assert_eq!(
        response.headers()["access-control-allow-origin"],
        "http://tauri.localhost"
    );
    assert!(
        response.headers()["access-control-allow-methods"]
            .to_str()
            .unwrap()
            .split(',')
            .any(|method| method.trim() == "DELETE")
    );
}

#[tokio::test]
async fn invalid_upload_is_rejected() {
    let root = tempdir().expect("temporary root should exist");
    let app = router_with_fs_root(root.path().to_path_buf());

    let garbage = vec![0u8; 128];
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/wallpaper/upload?label=Broken")
                .header("content-type", "image/png")
                .body(Body::from(garbage))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let empty: &[u8] = &[];
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/wallpaper/upload?label=")
                .header("content-type", "image/png")
                .body(Body::from(empty))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
