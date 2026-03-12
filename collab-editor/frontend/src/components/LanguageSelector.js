const LANGUAGES = [
  { value: 'python',     label: 'Python',     icon: '🐍' },
  { value: 'javascript', label: 'JavaScript', icon: '⚡' },
  { value: 'cpp',        label: 'C++',        icon: '⚙️'  },
  { value: 'java',       label: 'Java',       icon: '☕' },
];

function LanguageSelector({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="language-select"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.value} value={lang.value}>
          {lang.icon} {lang.label}
        </option>
      ))}
    </select>
  );
}

export default LanguageSelector;
