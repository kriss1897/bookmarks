import { useState } from 'react';
import { useSSE } from '../hooks/useSSE';

export function NamespaceSelector() {
  const { namespace, setNamespace, connectionStatus } = useSSE();
  const [inputValue, setInputValue] = useState(namespace);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      setNamespace(inputValue.trim());
    }
  };

  const predefinedNamespaces = ['bookmarks', 'notifications', 'chat', 'updates'];

  return (
    <div className="namespace-selector">
      <h3>Select Namespace</h3>
      
      {!namespace ? (
        <div>
          <p>Please select a namespace to connect to:</p>
          
          <form onSubmit={handleSubmit} className="namespace-form">
            <div className="input-group">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Enter namespace name..."
                className="namespace-input"
                required
              />
              <button type="submit" className="connect-button">
                Connect
              </button>
            </div>
          </form>

          <div className="predefined-namespaces">
            <p>Or choose a predefined namespace:</p>
            <div className="namespace-buttons">
              {predefinedNamespaces.map((ns) => (
                <button
                  key={ns}
                  onClick={() => {
                    setInputValue(ns);
                    setNamespace(ns);
                  }}
                  className="namespace-button"
                >
                  {ns}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="connected-namespace">
          <p>
            Connected to namespace: <strong>{namespace}</strong>
          </p>
          <p>
            Status: <span className={`status ${connectionStatus}`}>{connectionStatus}</span>
          </p>
          <button
            onClick={() => {
              setNamespace('');
              setInputValue('');
            }}
            className="disconnect-button"
          >
            Change Namespace
          </button>
        </div>
      )}

      <style>{`
        .namespace-selector {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
          background: #f9f9f9;
        }

        .namespace-selector h3 {
          margin-top: 0;
          color: #333;
        }

        .namespace-form {
          margin-bottom: 15px;
        }

        .input-group {
          display: flex;
          gap: 10px;
        }

        .namespace-input {
          flex: 1;
          padding: 8px 12px;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 14px;
        }

        .connect-button {
          padding: 8px 16px;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }

        .connect-button:hover {
          background: #0056b3;
        }

        .predefined-namespaces {
          margin-top: 15px;
        }

        .namespace-buttons {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .namespace-button {
          padding: 6px 12px;
          background: #6c757d;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }

        .namespace-button:hover {
          background: #545b62;
        }

        .connected-namespace {
          text-align: center;
        }

        .status {
          font-weight: bold;
          text-transform: capitalize;
        }

        .status.connected {
          color: green;
        }

        .status.connecting {
          color: orange;
        }

        .status.disconnected {
          color: red;
        }

        .disconnect-button {
          padding: 8px 16px;
          background: #dc3545;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          margin-top: 10px;
        }

        .disconnect-button:hover {
          background: #c82333;
        }
      `}</style>
    </div>
  );
}
