import React from 'react';

const AgeConfirmation = ({ onConfirm, onCancel }) => {
  return (
    <div className=" max-w-[500px] mt-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 rounded-3xl p-4 text-center">
      <h2 className="text-2xl font-mono font-bold mb-6 text-[#242124]">Age Confirmation</h2>
      <p className="text-md font-mono mb-8 text-[#242124] leading-tight">
        You must be at least 18 years old to use this site. Are you 18 or older?
      </p>
      <div className="flex justify-center gap-10">
        <button
          className="px-4 py-2 font-mono font-bold rounded-full bg-[#00008b] /80 text-white text-sm"
          onClick={onConfirm}
        >
          Proceed
        </button>
        <button
          className="px-4 py-2 font-mono font-bold rounded-full bg-[#87ceeb] /80 text-white text-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default AgeConfirmation;
