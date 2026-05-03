#[cfg(not(debug_assertions))]
use std::net::TcpListener;
#[cfg(not(debug_assertions))]
use std::process::Child;
#[cfg(not(debug_assertions))]
use std::sync::Mutex;
#[cfg(not(debug_assertions))]
use std::time::Duration;
#[cfg(not(debug_assertions))]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Holds the Bun server child process so we can kill it on app exit.
#[cfg(not(debug_assertions))]
struct ServerProcess(Mutex<Child>);

/// Ask the OS for a free port by binding to port 0, then immediately release it.
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
            let _app = app; // in dev, Vite handles the window
            #[cfg(not(debug_assertions))]
            {
                let port = find_free_port();
                let server_url = format!("http://127.0.0.1:{port}");

                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("could not resolve resource dir");

                // js-runtime is in Resources/runtime/ (a folder mapped via tauri.conf.json).
                // Using a folder means a single resources entry covers all platforms,
                // and Windows can keep the .exe extension.
                let bun_bin = if cfg!(windows) {
                    resource_dir.join("runtime").join("js-runtime.exe")
                } else {
                    resource_dir.join("runtime").join("js-runtime")
                };
                let index_js = resource_dir.join("build").join("index.js");

                // Spawn js-runtime via std::process::Command (not Tauri sidecar API)
                // This avoids linuxdeploy trying to run ldd on the Bun binary.
                // current_dir must be the build/ directory — index.js uses relative
                // paths for chunk loading that fail if CWD is anything else.
                let build_dir = resource_dir.join("build");
                let child = std::process::Command::new(&bun_bin)
                    .arg(&index_js)
                    .current_dir(&build_dir)
                    .env("PORT", port.to_string())
                    .env("HOST", "127.0.0.1")
                    .env("NODE_ENV", "production")
                    .spawn()
                    .expect("failed to spawn js-runtime");

                // Store the child so we can kill it when Tauri exits.
                app.manage(ServerProcess(Mutex::new(child)));

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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                #[cfg(not(debug_assertions))]
                if let Some(server) = app.try_state::<ServerProcess>() {
                    if let Ok(mut child) = server.0.lock() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
