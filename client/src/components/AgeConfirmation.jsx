import React from 'react';

const AgeConfirmation = ({ onConfirm, onCancel }) => {
  return (
    <div className="w-full max-w-[400px] mt-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 rounded-2xl shadow-lg p-3 text-center">
      <h2 className="text-base font-semibold mb-0.5 text-[#c46210]">Age Confirmation</h2>
      <p className="text-xs mb-2 text-[#c46210] leading-tight">
        You must be at least 18 years old to use this site. Are you 18 or older?
      </p>
      <div className="flex justify-center gap-3">
        <button
          className="px-3 py-1 rounded-full bg-[#8fbc8f] hover:bg-[#8fbc8f]/80 text-white text-sm"
          onClick={onConfirm}
        >
          Yes
        </button>
        <button
          className="px-3 py-1 rounded-full bg-[#ff7f50] hover:bg-[#ff7f50]/80 text-white text-sm"
          onClick={onCancel}
        >
          No
        </button>
      </div>
    </div>
  );
};

export default AgeConfirmation;
