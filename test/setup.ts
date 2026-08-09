// jsdom doesn't implement <dialog>'s imperative API (showModal/close) — polyfill just enough of
// it (toggling the `open` attribute, which jsdom does reflect) for dialog-driven flows to be
// testable.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
    this.setAttribute('open', '');
  };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
    this.removeAttribute('open');
  };
}
