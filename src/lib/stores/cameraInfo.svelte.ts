export interface CameraInfo {
  productname: string;
  serialnumber: string;
  firmwareversion: string;
  battery: {
    level: string;   // 'full' | 'high' | 'half' | 'quarter' | 'low' | 'exhausted' | 'charge' | 'chargestop' | 'chargecomp' | 'none' | 'unknown'
    quality: string; // 'normal' | 'degraded'
    name: string;
  };
  lens: string | null;
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

