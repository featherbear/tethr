// Tethr SFX stub
//
// This binary is concatenated with a zip payload:
//   [sfx.exe bytes][zip payload bytes]
//
// On launch it:
//   1. Reads itself from disk and finds the zip payload (by zip end-of-central-directory signature)
//   2. Extracts to %TEMP%\tethr-{version} (skips if already extracted)
//   3. Spawns tethr.exe from the extracted directory and waits for it to exit

#![windows_subsystem = "windows"]

use std::{
    env, fs,
    io::{self, Read, Seek, SeekFrom},
    path::PathBuf,
    process,
};

// The app version is baked in at compile time via build.rs or env var
const VERSION: &str = env!("SFX_VERSION");

fn main() {
    let exe_path = env::current_exe().expect("failed to get exe path");

    // Find the zip payload offset by scanning backwards for the zip EOCD signature
    let zip_offset = find_zip_offset(&exe_path).expect("failed to find zip payload in SFX");

    // Extract to %TEMP%\tethr-{version}
    let temp_dir: PathBuf = [
        env::var("TEMP").unwrap_or_else(|_| env::var("TMP").unwrap_or_else(|_| "C:\\Temp".into())),
        format!("tethr-{}", VERSION),
    ]
    .iter()
    .collect();

    let tethr_exe = temp_dir.join("tethr.exe");

    // Extract if not already done (or if tethr.exe is missing)
    if !tethr_exe.exists() {
        extract_zip(&exe_path, zip_offset, &temp_dir).expect("failed to extract payload");
    }

    // Launch tethr.exe and wait
    let status = process::Command::new(&tethr_exe)
        .current_dir(&temp_dir)
        .status()
        .expect("failed to launch tethr.exe");

    process::exit(status.code().unwrap_or(0));
}

/// Find the offset of the zip payload by scanning for the zip End of Central Directory signature
/// from the end of the file backwards, then finding the start of the local file header.
fn find_zip_offset(exe_path: &PathBuf) -> io::Result<u64> {
    let mut f = fs::File::open(exe_path)?;
    let file_size = f.seek(SeekFrom::End(0))?;

    // Scan backwards for EOCD signature: 0x06054b50
    // EOCD is at most 65535+22 bytes from the end
    let scan_start = file_size.saturating_sub(65535 + 22);
    let scan_len = file_size - scan_start;

    let mut buf = vec![0u8; scan_len as usize];
    f.seek(SeekFrom::Start(scan_start))?;
    f.read_exact(&mut buf)?;

    // Find last occurrence of EOCD signature
    let eocd_sig = [0x50, 0x4b, 0x05, 0x06];
    let eocd_pos = buf
        .windows(4)
        .rposition(|w| w == eocd_sig)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "EOCD not found"))?;

    // Offset of central directory start is at EOCD+16
    let eocd_abs = scan_start + eocd_pos as u64;
    let mut eocd_buf = [0u8; 22];
    f.seek(SeekFrom::Start(eocd_abs))?;
    f.read_exact(&mut eocd_buf)?;

    // Offset of start of central directory (bytes 16-19 of EOCD)
    let cd_offset = u32::from_le_bytes(eocd_buf[16..20].try_into().unwrap()) as u64;

    // The zip starts at the first local file header, which is before the central directory.
    // Walk back from cd_offset to find the first PK\x03\x04 signature.
    // For a simple case: the zip starts immediately after the SFX stub.
    // We find it by scanning forward from 0 for the first PK\x03\x04.
    let lf_sig = [0x50, 0x4b, 0x03, 0x04];
    let scan_end = cd_offset.min(file_size);
    let header_scan_len = scan_end as usize;
    let mut header_buf = vec![0u8; header_scan_len];
    f.seek(SeekFrom::Start(0))?;
    f.read_exact(&mut header_buf)?;

    let lf_pos = header_buf
        .windows(4)
        .position(|w| w == lf_sig)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "zip local file header not found"))?;

    Ok(lf_pos as u64)
}

/// Extract the zip payload starting at `offset` in `exe_path` into `dest_dir`.
fn extract_zip(exe_path: &PathBuf, offset: u64, dest_dir: &PathBuf) -> io::Result<()> {
    let file = fs::File::open(exe_path)?;
    let reader = OffsetReader::new(file, offset);
    let mut zip = zip::ZipArchive::new(reader)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    fs::create_dir_all(dest_dir)?;

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        let out_path = dest_dir.join(entry.name());

        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out_file = fs::File::create(&out_path)?;
            io::copy(&mut entry, &mut out_file)?;
        }
    }

    Ok(())
}

/// A reader that starts at a given byte offset within an underlying reader.
struct OffsetReader {
    inner: fs::File,
    offset: u64,
    pos: u64,
}

impl OffsetReader {
    fn new(mut inner: fs::File, offset: u64) -> Self {
        inner.seek(SeekFrom::Start(offset)).expect("seek to zip offset failed");
        Self { inner, offset, pos: 0 }
    }
}

impl Read for OffsetReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for OffsetReader {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        let new_pos = match from {
            SeekFrom::Start(n) => self.inner.seek(SeekFrom::Start(self.offset + n))? - self.offset,
            SeekFrom::Current(n) => self.inner.seek(SeekFrom::Current(n))? - self.offset,
            SeekFrom::End(n) => self.inner.seek(SeekFrom::End(n))? - self.offset,
        };
        self.pos = new_pos;
        Ok(new_pos)
    }
}
