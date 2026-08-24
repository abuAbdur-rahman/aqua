use axum::{Json, extract::State};
use serde::Serialize;

use crate::AppState;

#[derive(Serialize)]
pub(crate) struct ShutdownResponse {
    success: bool,
}

pub(crate) async fn shutdown(State(state): State<AppState>) -> Json<ShutdownResponse> {
    state.shutdown.notify_one();
    Json(ShutdownResponse { success: true })
}
