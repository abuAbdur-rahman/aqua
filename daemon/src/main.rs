use aqua_daemon::{daemon_addr, router_with_shutdown};
use tokio::{net::TcpListener, signal};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    init_tracing();

    if let Err(error) = serve().await {
        error!(%error, "daemon stopped with an error");
        std::process::exit(1);
    }
}

async fn serve() -> Result<(), std::io::Error> {
    let address = daemon_addr();
    let listener = TcpListener::bind(address).await?;
    info!(%address, "Aqua daemon listening");

    let (router, shutdown) = router_with_shutdown();
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    shutdown.shutdown();
    Ok(())
}

async fn shutdown_signal() {
    match signal::ctrl_c().await {
        Ok(()) => info!("shutdown signal received"),
        Err(error) => error!(%error, "failed to listen for shutdown signal"),
    }
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
}
