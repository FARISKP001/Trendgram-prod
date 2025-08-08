const WebbitLogo = ({ size = 48, style = {} }) => (
  <img
    src={logo}
    alt="TrendGram logo"
    style={{
      width: `${size}px`,
      height: `${size}px`,
      objectFit: 'contain',
      display: 'block',
      ...style,
    }}
    className="bg-white shadow-md rounded-md"
  />
);
