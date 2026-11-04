import React from 'react';
import { Button, Space, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

interface Props {
  title: React.ReactNode;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  /** 详情页返回按钮 */
  backTo?: string;
  backText?: string;
}

export default function PageHeader({ title, description, extra, backTo, backText = '返回' }: Props) {
  const navigate = useNavigate();
  return (
    <div className="sm-page-header">
      <div>
        {backTo && (
          <Button
            type="link"
            size="small"
            icon={<ArrowLeftOutlined />}
            style={{ paddingLeft: 0, marginBottom: 4 }}
            onClick={() => navigate(backTo)}
          >
            {backText}
          </Button>
        )}
        <h1 className="sm-page-title">{title}</h1>
        {description && (
          <div className="sm-page-desc">
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {description}
            </Typography.Text>
          </div>
        )}
      </div>
      {extra && <Space wrap>{extra}</Space>}
    </div>
  );
}
