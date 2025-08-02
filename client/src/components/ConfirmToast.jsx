import React from 'react';

const ConfirmToast = ({ message, onConfirm, onCancel }) => {
  return (
    <div
      style={{
        maxWidth: 300,
        fontFamily: 'system-ui, sans-serif',
        color: '#111',
      }}
    >
      <div style={{ marginBottom: 12, whiteSpace: 'pre-line' }}>
        ⚠️ <strong>Confirmation Needed</strong>
        <div style={{ marginTop: 6 }}>{message}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          onClick={onCancel}
          style={{
            background: '#6b7280',
            border: 'none',
            color: 'white',
            padding: '6px 14px',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          style={{
            background: '#ef4444',
            border: 'none',
            color: 'white',
            padding: '6px 14px',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Yes
        </button>
      </div>
    </div>
  );
};

export default ConfirmToast;
