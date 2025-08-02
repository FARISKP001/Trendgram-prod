import { toast } from 'react-toastify';
import React from 'react';
import ConfirmToast from '../components/ConfirmToast';

const showConfirmToast = ({ message, onConfirm, toastId = 'confirm-toast' }) => {
  toast.warning(
    React.createElement(({ closeToast }) =>
      React.createElement(ConfirmToast, {
        message,
        onConfirm: () => {
          closeToast();
          onConfirm();
        },
        onCancel: closeToast,
      })
    ),
    {
      autoClose: false,
      closeOnClick: false,
      draggable: false,
      toastId,
    }
  );
};

export default showConfirmToast;
