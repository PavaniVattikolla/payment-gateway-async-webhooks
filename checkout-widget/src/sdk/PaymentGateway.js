class PaymentGateway {
  constructor(options) {
    this.key = options.key;
    this.orderId = options.orderId;
    this.amount = options.amount;
    this.onSuccess = options.onSuccess;
    this.onFailure = options.onFailure;
    this.onClose = options.onClose;
    this.validateOptions();
  }

  validateOptions() {
    if (!this.key) {
      throw new Error('PaymentGateway: API key is required');
    }
    if (!this.orderId) {
      throw new Error('PaymentGateway: orderId is required');
    }
    if (typeof this.onSuccess !== 'function' && this.onSuccess !== undefined) {
      throw new Error('PaymentGateway: onSuccess must be a function');
    }
    if (typeof this.onFailure !== 'function' && this.onFailure !== undefined) {
      throw new Error('PaymentGateway: onFailure must be a function');
    }
  }

  open() {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'payment-gateway-modal';
    modal.setAttribute('data-test-id', 'payment-modal');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';

    // Create modal content
    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.cssText = 'position:relative;background:white;width:90%;max-width:500px;height:600px;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.1);';

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-button';
    closeBtn.setAttribute('data-test-id', 'close-modal-button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = 'position:absolute;top:10px;right:10px;background:none;border:none;font-size:24px;cursor:pointer;';
    closeBtn.onclick = () => this.close();

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-test-id', 'payment-iframe');
    iframe.src = `http://localhost:3001/checkout?order_id=${this.orderId}&embedded=true`;
    iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:8px;';

    content.appendChild(closeBtn);
    content.appendChild(iframe);
    modal.appendChild(content);
    document.body.appendChild(modal);

    this.modal = modal;
    this.iframe = iframe;

    // Listen for messages from iframe
    window.addEventListener('message', (event) => this.handleMessage(event));
  }

  handleMessage(event) {
    if (event.data.type === 'payment_success') {
      if (typeof this.onSuccess === 'function') {
        this.onSuccess(event.data.data);
      }
      this.close();
    } else if (event.data.type === 'payment_failed') {
      if (typeof this.onFailure === 'function') {
        this.onFailure(event.data.data);
      }
    }
  }

  close() {
    if (this.modal && this.modal.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }
    if (typeof this.onClose === 'function') {
      this.onClose();
    }
  }
}

window.PaymentGateway = PaymentGateway;
module.exports = PaymentGateway;
