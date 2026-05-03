fn main() {
    // Pass SFX_VERSION env var to the binary at compile time.
    // Falls back to "dev" if not set (local builds).
    let version = std::env::var("SFX_VERSION").unwrap_or_else(|_| "dev".into());
    println!("cargo:rustc-env=SFX_VERSION={version}");
    println!("cargo:rerun-if-env-changed=SFX_VERSION");
}
