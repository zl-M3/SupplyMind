import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './styles/theme.css';

dayjs.locale('zh-cn');

const FONT =
  "'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#f26522',
          colorInfo: '#f26522',
          colorSuccess: '#16a34a',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorTextBase: '#1f1b16',
          colorTextSecondary: '#8a8175',
          colorBorder: '#f1e6db',
          colorBorderSecondary: '#f7efe7',
          colorBgLayout: '#fffaf4',
          colorBgContainer: '#ffffff',
          borderRadius: 10,
          borderRadiusLG: 14,
          fontSize: 14,
          fontFamily: FONT,
          controlHeight: 36,
          wireframe: false,
        },
        components: {
          Layout: { headerBg: 'transparent', bodyBg: 'transparent' },
          Menu: {
            itemBg: 'transparent',
            itemSelectedBg: '#fff0e2',
            itemSelectedColor: '#d9500f',
            itemHoverBg: '#fff4e9',
            itemBorderRadius: 12,
            itemMarginInline: 0,
            subMenuItemBg: 'transparent',
          },
          Table: {
            headerBg: '#fff8f1',
            headerColor: '#8a8175',
            rowHoverBg: '#fffaf5',
            borderColor: '#f8efe6',
          },
          Card: { borderRadiusLG: 18 },
          Button: { primaryShadow: '0 8px 20px rgba(242,101,34,.28)' },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
