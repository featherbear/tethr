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

/// Check if WebView2 is installed (Windows only).
/// Returns true if found, false if missing.
#[cfg(target_os = "windows")]
fn check_webview2() -> bool {
    // WebView2 writes its version to the registry at:
    // HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}
    // or HKCU for per-user installs.
    use std::process::Command;
    let output = Command::new("reg")
        .args(["query",
            r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            "/v", "pv"])
        .output();
    if output.map(|o| o.status.success()).unwrap_or(false) {
        return true;
    }
    // Also check HKCU (per-user install)
    let output = Command::new("reg")
        .args(["query",
            r"HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            "/v", "pv"])
        .output();
    output.map(|o| o.status.success()).unwrap_or(false)
}

/// Show a native Windows message box.
#[cfg(target_os = "windows")]
fn show_message_box(title: &str, message: &str) {
    use std::process::Command;
    // Use PowerShell to show a message box — available on all Windows versions
    let ps_cmd = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         [System.Windows.Forms.MessageBox]::Show('{}', '{}', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)",
        message.replace('\'', "''"),
        title.replace('\'', "''")
    );
    let _ = Command::new("powershell")
        .args(["-Command", &ps_cmd])
        .output();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(debug_assertions)]
            let _app = app; // in dev, Vite handles the window
            #[cfg(not(debug_assertions))]
            {
                // Check WebView2 is installed (Windows only)
                #[cfg(target_os = "windows")]
                if !check_webview2() {
                    show_message_box(
                        "Tethr — Missing Dependency",
                        "Microsoft WebView2 Runtime is required to run Tethr.\n\nPlease download and install it from:\nhttps://developer.microsoft.com/microsoft-edge/webview2/\n\nTethr will now exit."
                    );
                    std::process::exit(1);
                }

                let port = find_free_port();
                let server_url = format!("http://127.0.0.1:{port}");

                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("could not resolve resource dir");

                // Change the process CWD away from wherever the .app was launched
                // (e.g. ~/Downloads/). This prevents any relative path access from
                // triggering a macOS TCC "Downloads folder" permission prompt.
                std::env::set_current_dir(&resource_dir).ok();

                // js-runtime is in Resources/runtime/ (a folder mapped via tauri.conf.json).
                // Using a folder means a single resources entry covers all platforms,
                // and Windows can keep the .exe extension.
                // js-runtime is staged into build/runtime/ before bundling,
                // so it ends up in Resources/build/runtime/ inside the .app.
                let bun_bin = if cfg!(windows) {
                    resource_dir.join("build").join("runtime").join("js-runtime.exe")
                } else {
                    resource_dir.join("build").join("runtime").join("js-runtime")
                };
                let index_js = resource_dir.join("build").join("index.js");

                // Spawn js-runtime via std::process::Command (not Tauri sidecar API)
                // This avoids linuxdeploy trying to run ldd on the Bun binary.
                // current_dir must be the build/ directory — index.js uses relative
                // paths for chunk loading that fail if CWD is anything else.
                let build_dir = resource_dir.join("build");

                // Verify required files exist before spawning
                if !bun_bin.exists() {
                    eprintln!("tethr: js-runtime not found at {}", bun_bin.display());
                    std::process::exit(1);
                }
                if !index_js.exists() {
                    eprintln!("tethr: index.js not found at {}", index_js.display());
                    std::process::exit(1);
                }

                let child = std::process::Command::new(&bun_bin)
                    .arg(&index_js)
                    .current_dir(&build_dir)
                    .env("PORT", port.to_string())
                    .env("HOST", "127.0.0.1")
                    .env("NODE_ENV", "production")
                    .spawn()
                    .unwrap_or_else(|e| {
                        eprintln!("tethr: failed to spawn js-runtime at {}: {}", bun_bin.display(), e);
                        std::process::exit(1);
                    });

                // Store the child so we can kill it when Tauri exits.
                app.manage(ServerProcess(Mutex::new(child)));

                // Poll until the SvelteKit server is ready (max ~10s).
                // A successful TCP connect to the port means the server is up.
                // No HTTP needed — avoids pulling in ureq + rustls + ring (~35MB).
                let addr = format!("127.0.0.1:{port}");
                let ready = (|| {
                    for _ in 0..40 {
                        std::thread::sleep(Duration::from_millis(250));
                        if std::net::TcpStream::connect(&addr).is_ok() {
                            return true;
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
