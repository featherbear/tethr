use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                // In production: spawn the SvelteKit Node sidecar
                let sidecar = app.shell().sidecar("node-server").expect("node-server sidecar not found");
                let (_rx, _child) = sidecar.spawn().expect("failed to spawn node-server sidecar");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
