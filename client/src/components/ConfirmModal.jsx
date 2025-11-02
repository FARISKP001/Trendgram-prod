import React from 'react';

const ConfirmModal = ({ onConfirm, onCancel }) => {
  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
    >
         <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
        <h2 id="confirm-title" className="text-lg font-bold text-gray-800 mb-3">
          Leave Chat?
        </h2>
       <p id="confirm-desc" className="text-sm text-gray-600 mb-6">
          You'll be disconnected. Are you sure?
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 transition"
          >
            No
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
