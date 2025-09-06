import React from 'react';

const AgeConfirmation = ({ onConfirm, onCancel }) => {
  return (
    <div className="w-full max-w-[600px] mt-4 bg-white text-gray-800 rounded-2xl shadow-lg p-6 text-center">
      <h2 className="text-lg font-semibold mb-2 text-[#c46210]">Age Confirmation</h2>
      <p className="text-sm mb-6 text-[#c46210]">
        You must be at least 18 years old to use this site. Are you 18 or older?
      </p>
      <div className="flex justify-center gap-4">
        <button
          className="px-4 py-2 rounded-full bg-[#8fbc8f] hover:bg-[#8fbc8f]/80 text-white"
          onClick={onConfirm}
        >
          Yes
        </button>
        <button
          className="px-4 py-2 rounded-full bg-[#ff7f50] hover:bg-[#ff7f50]/80 text-white"
          onClick={onCancel}
        >
          No
        </button>
      </div>
    </div>
  );
};

export default AgeConfirmation;
