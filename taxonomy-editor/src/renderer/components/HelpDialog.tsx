interface HelpDialogProps {
  onClose: () => void;
}

export function HelpDialog({ onClose }: HelpDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog help-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Taxonomy Editor Help</h3>

        <div className="help-section">
          <h4>Overview</h4>
          <p>
            This editor manages the AI Triad taxonomy across three perspectives
            (Accelerationist, Safetyist, Skeptic), cross-cutting concepts shared
            across perspectives, and documented conflicts between positions.
          </p>
        </div>

        <div className="help-section">
          <h4>Keyboard Shortcuts</h4>
          <table className="help-shortcuts">
            <tbody>
              <tr><td className="help-key">Ctrl + F</td><td>Open / close search</td></tr>
              <tr><td className="help-key">Ctrl + S</td><td>Save changes</td></tr>
              <tr><td className="help-key">Ctrl + =</td><td>Zoom in</td></tr>
              <tr><td className="help-key">Ctrl + -</td><td>Zoom out</td></tr>
              <tr><td className="help-key">Ctrl + 0</td><td>Reset zoom</td></tr>
              <tr><td className="help-key">Arrow Up/Down</td><td>Navigate items in list</td></tr>
              <tr><td className="help-key">Enter</td><td>Next search result</td></tr>
              <tr><td className="help-key">Shift + Enter</td><td>Previous search result</td></tr>
              <tr><td className="help-key">Escape</td><td>Close search / dialogs</td></tr>
            </tbody>
          </table>
        </div>

        <div className="help-section">
          <h4>Tabs</h4>
          <p>
            <strong>Accelerationist / Safetyist / Skeptic</strong> - Each perspective
            has nodes organized into three categories: Goals/Values, Methods, and Data/Facts.
          </p>
          <p>
            <strong>Cross-Cutting</strong> - Concepts that span all three perspectives.
            Each node includes how each perspective interprets the concept.
          </p>
          <p>
            <strong>Conflicts</strong> - Documented disagreements between perspectives,
            with source instances and analyst notes.
          </p>
        </div>

        <div className="help-section">
          <h4>Features</h4>
          <p><strong>Pin</strong> - Pin any item to compare it side-by-side with the active item.</p>
          <p><strong>Search</strong> - Full-text search with raw, wildcard, and regex modes. Scope by POV and/or category.</p>
          <p><strong>Resize</strong> - Drag the border between the list and detail panels to resize.</p>
        </div>

        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
