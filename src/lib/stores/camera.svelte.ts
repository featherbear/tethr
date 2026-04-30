export type ConnectionStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error' | 'stopped';

const ls = (key: string, fallback: string) =>
  typeof localStorage !== 'undefined' ? (localStorage.getItem(key) ?? fallback) : fallback;

export const cameraStore = (() => {
  let ip       = $state<string>(ls('camera_ip', '192.168.1.2'));
  let port     = $state<number>(parseInt(ls('camera_port', '8080')));
  let useHttps = $state<boolean>(ls('camera_https', 'false') === 'true');
  let status   = $state<ConnectionStatus>('idle');
  let errorMessage = $state<string | null>(null);

  function setIp(value: string) {
    ip = value;
    if (typeof localStorage !== 'undefined') localStorage.setItem('camera_ip', value);
  }

  function setPort(value: number) {
    port = value;
    if (typeof localStorage !== 'undefined') localStorage.setItem('camera_port', String(value));
  }

  function setHttps(value: boolean) {
    useHttps = value;
    if (typeof localStorage !== 'undefined') localStorage.setItem('camera_https', String(value));
  }

  function setStatus(value: ConnectionStatus, error?: string) {
    status = value;
    errorMessage = error ?? null;
  }

  return {
    get ip()           { return ip; },
    get port()         { return port; },
    get useHttps()     { return useHttps; },
    get status()       { return status; },
    get errorMessage() { return errorMessage; },
    setIp,
    setPort,
    setHttps,
    setStatus,
  };
})();
