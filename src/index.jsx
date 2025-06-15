// Import React and ReactDOM for JSX rendering and root management
import React from "react";
import ReactDOM from "react-dom/client";
// Import Nebula hooks for Qlik extension integration
import { useElement, useLayout, useEffect } from "@nebula.js/stardust";

// Import Qlik extension property/config definitions
import properties from "./object-properties";
import data from "./data";
import ext from "./ext";

// Pure React component to render a Qlik table
function MyTable({ layout }) {
  // If no dimensions/measures are configured, prompt the user
  if (!layout.qHyperCube || !layout.qHyperCube.qDimensionInfo.length) {
    return (
      <div style={{ padding: 24, color: "#666" }}>
        No data yet.
        <br />
        Add a dimension and a measure.
      </div>
    );
  }
  // Extract columns (headers) and rows from the hypercube data structure
  const hc = layout.qHyperCube;
  const columns = [...hc.qDimensionInfo, ...hc.qMeasureInfo].map(
    (f) => f.qFallbackTitle
  );
  const rows = hc.qDataPages[0].qMatrix;

  // Render a basic HTML table using JSX
  return (
    <table border="1">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell.qText}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Main entry point for the Qlik supernova extension
export default function supernova(galaxy) {
  return {
    // Qlik associative engine config (data structure, property panel, etc.)
    qae: { properties, data },
    // Nebula property panel/ext config
    ext: ext(galaxy),
    // Main component mounting function for the extension
    component() {
      // Get reference to the DOM element Nebula provides
      const element = useElement();
      // Get current data/layout from Qlik
      const layout = useLayout();

      // React-like effect: runs every time 'element' or 'layout' changes
      useEffect(() => {
        // If we've rendered React into this element before, unmount the previous root
        if (element.__root) {
          element.__root.unmount();
        }
        // Create a new React root in the provided DOM element
        element.__root = ReactDOM.createRoot(element);
        // Render the table component, passing in the current layout
        element.__root.render(<MyTable layout={layout} />);
        // Clean up on component unmount or re-render
        return () => {
          if (element.__root) {
            element.__root.unmount();
            element.__root = null;
          }
        };
      }, [element, layout]);
    },
  };
}
