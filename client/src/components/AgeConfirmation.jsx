import React from 'react';

const AgeConfirmation = ({ onConfirm, onCancel }) => {
  return (
    <div className="w-full max-w-[600px] mt-4 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 rounded-2xl shadow-lg p-6 text-center">
      <h2 className="text-lg font-semibold mb-2">Age Confirmation</h2>
      <p className="text-sm mb-6">
        You must be at least 18 years old to use this site. Are you 18 or older?
      </p>
      <div className="flex justify-center gap-4">
        <button
          className="px-4 py-2 rounded-full bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
          onClick={onCancel}
        >
          No
        </button>
        <button
          className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white"
          onClick={onConfirm}
        >
          Yes
        </button>
      </div>
    </div>
  );
};

export default AgeConfirmation;