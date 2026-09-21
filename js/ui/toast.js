/**
 * ContiFor - Sistema di Notifiche Toast Touch-Friendly
 */

export class Toast {
  static container = null;

  static init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  }

  static show(message, type = 'info', duration = 3500) {
    this.init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} animate-slide-up`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';
    if (type === 'warning') icon = '🔔';

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${message}</span>
    `;

    this.container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-fade-out');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, duration);
  }

  static success(msg, duration) {
    this.show(msg, 'success', duration);
  }

  static error(msg, duration = 5000) {
    this.show(msg, 'error', duration);
  }

  static info(msg, duration) {
    this.show(msg, 'info', duration);
  }
}
