import React from 'react';

const ConfirmToast = ({ message, onConfirm, onCancel }) => {
  return (
    <div
      style={{
        maxWidth: 300,
        fontFamily: 'system-ui, sans-serif',
        color: '#3cb371',
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
            background: '#ff7f50',
            border: 'none',
            color: 'white',
            padding: '6px 14px',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          No
        </button>
        <button
          onClick={onConfirm}
          style={{
            background: '#8fbc8f',
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
