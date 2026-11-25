import {execFile} from 'node:child_process';

export function massiveCurlConfig(path, key) {
  if (typeof path !== 'string' || !path.startsWith('/v') || /[\s"\\]/.test(path) || new URL(path, 'https://api.massive.com').origin !== 'https://api.massive.com') throw new Error('Invalid official API path');
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(key)) throw new Error('Invalid API key format');
  return 'url = "https://api.massive.com' + path + '"\nheader = "Authorization: Bearer ' + key + '"\nheader = "Accept: application/json"\n';
}

export function requestMassiveJson(path, key, runner = execFile) {
  const configuration = massiveCurlConfig(path, key);
  return new Promise((resolve, reject) => {
    const child = runner('/usr/bin/curl', ['--disable', '--config', '-', '--silent', '--show-error', '--max-time', '25', '--proto', '=https', '--max-redirs', '0', '--write-out', '\n%{http_code}'], {maxBuffer: 1024 * 1024, timeout: 30000}, (error, stdout) => {
      if (error) return reject(new Error('System HTTPS client unavailable or response oversized'));
      const boundary = stdout.lastIndexOf('\n'), status = stdout.slice(boundary + 1);
      if (boundary < 0 || !/^\d{3}$/.test(status)) return reject(new Error('Invalid HTTP metadata'));
      const httpStatus = Number(status);
      if (httpStatus < 200 || httpStatus >= 300) return resolve({httpStatus});
      try {
        resolve({httpStatus, payload: JSON.parse(stdout.slice(0, boundary))});
      } catch {
        reject(new Error('Invalid JSON response'));
      }
    });
    child.stdin.on('error', () => reject(new Error('System HTTPS client input unavailable')));
    child.stdin.end(configuration);
  });
}
