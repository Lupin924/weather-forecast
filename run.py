"""
WeatherForecast 应用启动脚本。
用于 PyInstaller 打包后的入口，负责启动 FastAPI/uvicorn 服务并自动打开浏览器。
无控制台窗口模式，日志写入文件。
"""
import logging
import os
import socket
import sys
import threading
import time
from pathlib import Path

from app.paths import MODE, LOGS_DIR


def get_log_dir() -> Path:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    return LOGS_DIR


def setup_logging() -> Path:
    log_dir = get_log_dir()
    log_file = log_dir / "weather_forecast.log"
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        handlers=[
            logging.FileHandler(str(log_file), encoding='utf-8'),
        ]
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    return log_file


def is_port_available(host: str, port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, port))
        sock.close()
        return True
    except OSError:
        sock.close()
        return False


def wait_for_server(host: str, port: int, max_wait: float = 15.0) -> bool:
    logger = logging.getLogger(__name__)
    start = time.time()
    while time.time() - start < max_wait:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.5)
            result = sock.connect_ex((host, port))
            sock.close()
            if result == 0:
                logger.info(f"服务器就绪: {host}:{port}")
                return True
        except Exception:
            pass
        time.sleep(0.3)
    logger.warning(f"等待服务器就绪超时 ({max_wait}s)")
    return False


def open_browser(url: str):
    logger = logging.getLogger(__name__)
    try:
        if sys.platform == 'win32':
            os.startfile(url)
        else:
            import webbrowser
            webbrowser.open(url)
        logger.info(f"已尝试打开浏览器: {url}")
    except Exception as e:
        logger.error(f"打开浏览器失败: {e}")


def main():
    log_file = setup_logging()
    logger = logging.getLogger(__name__)

    logger.info("=" * 50)
    logger.info("WeatherForecast 应用启动")
    logger.info(f"运行模式: {MODE}")
    logger.info(f"日志文件: {log_file}")

    host = "127.0.0.1"
    port = 8000

    if not is_port_available(host, port):
        logger.warning(f"端口 {port} 已被占用，尝试直接打开浏览器...")
        open_browser(f"http://{host}:{port}")
        logger.info("如果页面无法加载，请关闭占用端口的程序后重试")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        return

    try:
        from app.main import app
    except Exception as e:
        logger.error(f"导入应用失败: {e}", exc_info=True)
        time.sleep(3)
        sys.exit(1)

    def run_server():
        try:
            import uvicorn
            uvicorn.run(
                app,
                host=host,
                port=port,
                log_level="warning",
                log_config=None,
                access_log=False,
            )
        except Exception as e:
            logger.error(f"服务器启动失败: {e}", exc_info=True)

    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    logger.info("服务器线程已启动")

    if wait_for_server(host, port):
        url = f"http://{host}:{port}"
        logger.info(f"服务已启动: {url}")
        open_browser(url)
    else:
        logger.error("服务器未在预期时间内就绪")
        open_browser(f"http://{host}:{port}")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("收到中断信号，正在关闭...")
    except Exception as e:
        logger.error(f"主线程异常: {e}", exc_info=True)
    finally:
        logger.info("应用退出")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        try:
            logger = logging.getLogger(__name__)
            logger.critical(f"未捕获的异常: {e}", exc_info=True)
        except Exception:
            pass
        time.sleep(3)
