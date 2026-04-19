import React from "react";
import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/pipeline", label: "Run Pipeline" },
];

function Navbar() {
  return (
    <header className="navbar">
      <div className="brand-wrap">
        <p className="brand-eyebrow">Restaurant Lead Engine</p>
        <h1 className="brand-title">Outreach MVP</h1>
      </div>
      <nav className="nav-links">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive ? "nav-link nav-link-active" : "nav-link"
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

export default Navbar;
