import { useEffect } from 'react';
import { toast } from 'react-hot-toast';

/** Surface a failed read once per transition rather than once per render. */
export function useQueryErrorToast(isError: boolean, message: string, id: string) {
  useEffect(() => {
    if (isError) toast.error(message, { duration: 5000, position: 'top-center', id });
  }, [isError, message, id]);
}
