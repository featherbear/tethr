export type ConnectionStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';

export const cameraStore = (() => {
  let ip = $state<string>(typeof localStorage !== 'undefined' ? (localStorage.getItem('camera_ip') ?? '192.168.1.2') : '192.168.1.2');
  let port = $state<number>(8080);
  let status = $state<ConnectionStatus>('idle');
  let errorMessage = $state<string | null>(null);

  function setIp(value: string) {
    ip = value;
    if (typeof localStorage !== 'undefined') localStorage.setItem('camera_ip', value);
  }

  function setPort(value: number) {
    port = value;
  }

  function setStatus(value: ConnectionStatus, error?: string) {
    status = value;
    errorMessage = error ?? null;
  }

  return {
    get ip() { return ip; },
    get port() { return port; },
    get status() { return status; },
    get errorMessage() { return errorMessage; },
    setIp,
    setPort,
    setStatus,
  };
})();
