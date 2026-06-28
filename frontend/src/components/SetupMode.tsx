import { useState } from 'react';

export default function SetupMode() {
  const urlParams = new URLSearchParams(window.location.search);

  const initialId = urlParams.get('id') || '1';

  const [inputId, setInputId] = useState(initialId);

  const handleModeSelect = (selectedMode: 'camera' | 'viewer') => {
    window.location.href = `/?id=${inputId}&mode=${selectedMode}`;
  };

  return (
    <div className="selection-container">
      <div className="input-group">
        <label htmlFor="id-input">Room ID</label>
        <input
          id="id-input"
          type="text"
          value={inputId}
          onChange={(e) => setInputId(e.target.value)}
          placeholder="Enter ID"
        />
      </div>

      <div className="button-group">
        <button onClick={() => handleModeSelect('camera')} className="mode-button">
          Camera Mode
        </button>
        <button onClick={() => handleModeSelect('viewer')} className="mode-button">
          Viewer Mode
        </button>
      </div>
    </div>
  );
}
