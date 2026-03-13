/*
  LanguageSelector — Dropdown with proper devicon SVG logos (#5).
  Python (snake), JavaScript (JS logo), C++ (hexagon), Java (coffee cup).
*/
const DEVICON_BASE = 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons';

const LANGUAGES = [
  { value: 'python',     label: 'Python',     icon: `${DEVICON_BASE}/python/python-original.svg` },
  { value: 'javascript', label: 'JavaScript', icon: `${DEVICON_BASE}/javascript/javascript-original.svg` },
  { value: 'cpp',        label: 'C++',        icon: `${DEVICON_BASE}/cplusplus/cplusplus-original.svg` },
  { value: 'java',       label: 'Java',       icon: `${DEVICON_BASE}/java/java-original.svg` },
];

function LanguageSelector({ value, onChange }) {
  return (
    <div className="language-selector-wrap">
      <img
        src={LANGUAGES.find(l => l.value === value)?.icon || LANGUAGES[0].icon}
        alt=""
        className="lang-select-icon"
        width="16"
        height="16"
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="language-select"
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default LanguageSelector;
