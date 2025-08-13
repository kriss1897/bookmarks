import React from 'react';

interface DatabaseBlockedNotificationProps {
  onClose?: () => void;
}

export function DatabaseBlockedNotification({ onClose }: DatabaseBlockedNotificationProps) {
  React.useEffect(() => {
    const handleDatabaseBlocked = (event: CustomEvent) => {
      console.log('Database blocked event received:', event.detail);
    };

    window.addEventListener('database-blocked', handleDatabaseBlocked as EventListener);
    
    return () => {
      window.removeEventListener('database-blocked', handleDatabaseBlocked as EventListener);
    };
  }, []);

  const handleRefresh = () => {
    window.location.reload();
  };

  const handleCloseOtherTabs = () => {
    // This will only work if the user manually closes other tabs
    alert('Please manually close any other tabs or windows that have this app open, then click "Refresh Page".');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4">
        <div className="flex items-center mb-4">
          <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center mr-3">
            <span className="text-white font-bold">!</span>
          </div>
          <h3 className="text-lg font-semibold text-gray-900">
            Database Upgrade Required
          </h3>
        </div>
        
        <div className="mb-6">
          <p className="text-gray-600 mb-3">
            The app needs to upgrade its local database, but this is blocked by other tabs or windows that have the app open.
          </p>
          
          <p className="text-gray-600 mb-3">
            <strong>To resolve this:</strong>
          </p>
          
          <ol className="list-decimal list-inside text-gray-600 space-y-1 mb-4">
            <li>Close all other tabs/windows with this app</li>
            <li>Refresh this page</li>
          </ol>
          
          <p className="text-sm text-gray-500">
            This only needs to be done once for the database upgrade.
          </p>
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={handleCloseOtherTabs}
            className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Help Me Close Tabs
          </button>
          
          <button
            onClick={handleRefresh}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Refresh Page
          </button>
        </div>
        
        {onClose && (
          <button
            onClick={onClose}
            className="mt-3 w-full text-gray-500 hover:text-gray-700 text-sm"
          >
            Dismiss (not recommended)
          </button>
        )}
      </div>
    </div>
  );
}

export default DatabaseBlockedNotification;
