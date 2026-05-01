#[cfg(not(debug_assertions))]
use std::net::TcpListener;
#[cfg(not(debug_assertions))]
use std::time::Duration;
#[cfg(not(debug_assertions))]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

/// Ask the OS for a free port by binding to port 0, then immediately release it.
/// There is a small TOCTOU window, but it is acceptable for a local sidecar.
#[cfg(not(debug_assertions))]
fn find_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("could not bind to find a free port")
        .local_addr()
        .expect("could not get local addr")
        .port()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            let _app = app; // in dev, app is unused — Vite handles the window
            #[cfg(not(debug_assertions))]
            {
                let port = find_free_port();
                let server_url = format!("http://127.0.0.1:{port}");

                // Resolve the path to build/index.js inside Resources
                let resource_path = app
                    .path()
                    .resource_dir()
                    .expect("could not resolve resource dir")
                    .join("build/index.js");

                // Spawn the SvelteKit server via Bun sidecar on the chosen port
                let sidecar_cmd = app
                    .shell()
                    .sidecar("bun-server")
                    .expect("bun-server sidecar not configured")
                    .args([resource_path.to_str().expect("resource path is not valid UTF-8")])
                    .env("PORT", port.to_string())
                    .env("HOST", "127.0.0.1");

                let (_rx, _child) = sidecar_cmd.spawn().expect("failed to spawn node-server");

                // Poll until the SvelteKit server is ready (max ~10s)
                let health_url = format!("{server_url}/");
                let ready = (|| {
                    for _ in 0..40 {
                        std::thread::sleep(Duration::from_millis(250));
                        if let Ok(resp) = ureq::get(&health_url).call() {
                            if resp.status() < 500 {
                                return true;
                            }
                        }
                    }
                    false
                })();

                if !ready {
                    eprintln!("tethr: SvelteKit server did not become ready in time");
                }

                // Open the main window pointing at the local server
                WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::External(server_url.parse().expect("invalid server URL")),
                )
                .title("Tethr")
                .inner_size(1440.0, 900.0)
                .resizable(true)
                .build()
                .expect("failed to create main window");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
