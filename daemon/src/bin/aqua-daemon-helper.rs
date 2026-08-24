use std::{
    io::{self, Read},
    path::PathBuf,
};

use aqua_daemon::fs::{FsOp, run_privileged_operation};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperRequest {
    #[serde(flatten)]
    operation: FsOp,
    allowed_root: PathBuf,
}

#[derive(Serialize)]
struct HelperResponse {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn main() {
    let response = match read_request() {
        Ok(request) => match run_privileged_operation(&request.allowed_root, request.operation) {
            Ok(()) => HelperResponse {
                success: true,
                error: None,
            },
            Err(error) => HelperResponse {
                success: false,
                error: Some(error.message().to_owned()),
            },
        },
        Err(error) => HelperResponse {
            success: false,
            error: Some(error),
        },
    };
    if serde_json::to_writer(io::stdout(), &response).is_err() {
        std::process::exit(1);
    }
    if !response.success {
        std::process::exit(1);
    }
}

fn read_request() -> Result<HelperRequest, String> {
    let mut input = Vec::new();
    io::stdin()
        .read_to_end(&mut input)
        .map_err(|_| "helper input failed".to_owned())?;
    serde_json::from_slice(&input).map_err(|_| "invalid helper request".to_owned())
}
