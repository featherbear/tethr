use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                // Resolve the path to build/index.js inside Resources
                let resource_path = app
                    .path()
                    .resource_dir()
                    .expect("could not resolve resource dir")
                    .join("build/index.js");

                // Spawn the SvelteKit Node sidecar
                let sidecar_cmd = app
                    .shell()
                    .sidecar("node-server")
                    .expect("node-server sidecar not configured")
                    .args([resource_path.to_str().expect("resource path is not valid UTF-8")])
                    .env("PORT", "3000")
                    .env("HOST", "127.0.0.1");

                let (_rx, _child) = sidecar_cmd.spawn().expect("failed to spawn node-server");

                // Poll until the SvelteKit server is ready (max ~10s)
                let ready = (|| {
                    for _ in 0..40 {
                        std::thread::sleep(Duration::from_millis(250));
                        if let Ok(resp) =
                            ureq::get("http://127.0.0.1:3000/").call()
                        {
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
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(
                    "http://127.0.0.1:3000".parse().expect("invalid server URL"),
                ))
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
