/* eslint-disable */
/* T99-T62: bridge T-61's 'order-update' CustomEvents to user-visible toasts.

   T-61 dispatches:
     window.addEventListener('order-update', e => e.detail = {
       orderId, status, symbol, side, quantity, filledQty, price, avgPrice, ts, ...
     })

   We render a toast per terminal status. Non-terminal updates (OPEN,
   TRIGGER_PENDING, etc.) are noisy and don't warrant a toast — only the
   final outcomes do.

   This is mount-and-forget: the component returns null and just sets up
   the listener once. It coexists with the global ToastHost (T-prior) which
   handles the actual rendering.
*/

const OrderToastBridge = () => {
  React.useEffect(() => {
    const onOrderUpdate = (e) => {
      const d = e.detail || {};
      const status = String(d.status || '').toUpperCase();
      const symbol = d.symbol || d.orderId || 'order';
      const side = d.side ? String(d.side).toUpperCase() : '';
      const qty = d.filledQty || d.quantity || '';
      const px  = d.avgPrice || d.price;
      const sub = [side, qty, symbol].filter(Boolean).join(' ')
                + (px ? ` @ ₹${Number(px).toFixed(2)}` : '');

      if (status === 'COMPLETE') {
        try {
          window.toast({
            kind: 'up',
            title: 'Order filled',
            sub,
          });
        } catch (_) {}
        return;
      }
      if (status === 'REJECTED') {
        try {
          window.toast({
            kind: 'down',
            title: 'Order rejected',
            sub: sub + (d.statusMsg ? ` — ${String(d.statusMsg).slice(0, 60)}` : ''),
          });
        } catch (_) {}
        return;
      }
      if (status === 'CANCELLED') {
        try {
          window.toast({
            kind: 'warn',
            title: 'Order cancelled',
            sub,
          });
        } catch (_) {}
        return;
      }
      // Other statuses (OPEN, TRIGGER_PENDING, etc.) — silent.
    };
    window.addEventListener('order-update', onOrderUpdate);
    return () => window.removeEventListener('order-update', onOrderUpdate);
  }, []);
  return null;
};

Object.assign(window, { OrderToastBridge });
