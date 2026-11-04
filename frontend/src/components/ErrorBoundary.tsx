import React from 'react';
import { Button, Result } from 'antd';

interface Props {
  children: React.ReactNode;
}

interface State {
  error?: Error;
}

/** 全局错误边界：某个页面渲染崩了，不至于整站白屏。 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 控制台保留堆栈，便于排查
    console.error('页面渲染出错：', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <Result
          status="500"
          title="页面出错了"
          subTitle={this.state.error.message || '渲染时发生未知错误'}
          extra={
            <Button
              type="primary"
              onClick={() => {
                this.setState({ error: undefined });
                window.location.reload();
              }}
            >
              刷新页面
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
