export interface CameraInfo {
  productname: string;
  serialnumber: string;
  firmwareversion: string;
  battery: {
    level: string;
    quality: string;
    name: string;
  };
  storage: {
    name: string;
    maxsize: number;
    spacesize: number;
    contentsnumber: number;
  } | null;
}

export const cameraInfoStore = (() => {
  let info = $state<CameraInfo | null>(null);
  let loading = $state(false);

  function set(value: CameraInfo | null) {
    info = value;
  }

  function setLoading(value: boolean) {
    loading = value;
  }

  return {
    get info()    { return info; },
    get loading() { return loading; },
    set,
    setLoading,
  };
})();

/** Format bytes as human-readable GB/MB string */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

/** Battery level → colour */
export function batteryColor(level: string): string {
  switch (level) {
    case 'high': return '#22c55e';
    case 'half': return '#f59e0b';
    case 'low':  return '#ef4444';
    default:     return '#6b7280';
  }
}

/** Battery level → icon character */
export function batteryIcon(level: string): string {
  switch (level) {
    case 'high': return '🔋';
    case 'half': return '🔋';
    case 'low':  return '🪫';
    default:     return '🔋';
  }
}
