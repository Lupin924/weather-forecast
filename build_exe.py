"""
打包脚本：将 Weather Forecast 应用打包为单文件 Windows EXE。

运行方法：
    pip install pyinstaller
    python build_exe.py

产物说明：
    - 主 EXE: dist/WeatherForecast.exe (单个文件，约 30MB)
    - 双击即可运行，自动解压到临时目录后启动服务
"""
import subprocess
import sys
from pathlib import Path


def main():
    print("开始打包 (onefile 单文件模式)...")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "build.spec",
        "--noconfirm",
        "--clean",
    ]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            cwd=str(Path(__file__).parent)
        )
        if result.stdout:
            # 只输出关键信息，避免日志过长
            for line in result.stdout.split('\n'):
                if any(kw in line.lower() for kw in ['successfully', 'completed', 'error', 'fail']):
                    print(line)

        if result.returncode != 0:
            print("STDERR (错误摘要):")
            for line in result.stderr.split('\n')[-30:]:
                if line.strip():
                    print(line)
            print("\n打包失败！请检查上方错误信息。")
            sys.exit(1)
        else:
            exe_path = Path("dist/WeatherForecast.exe")
            if exe_path.exists():
                size_mb = exe_path.stat().st_size / (1024 * 1024)
                print("\n" + "=" * 50)
                print("✅ 打包成功！")
                print("=" * 50)
                print(f"产物位置: {exe_path.absolute()}")
                print(f"文件大小: {size_mb:.1f} MB")
                print("-" * 50)
                print("使用说明:")
                print("  1. 将 WeatherForecast.exe 复制到任意 Windows 电脑")
                print("  2. 双击即可运行，程序会自动解压并启动服务")
                print("  3. 浏览器将自动打开应用页面")
                print("-" * 50)
                print("注意事项:")
                print("  • 首次启动需要几秒钟解压时间")
                print("  • 运行期间勿关闭命令行窗口（如出现）")
                print("  • 如需退出，在任务管理器结束 WeatherForecast.exe")
            else:
                print("错误: 未找到产物 dist/WeatherForecast.exe")
                sys.exit(1)
    except FileNotFoundError:
        print("未找到 PyInstaller，请先执行: pip install pyinstaller")
        sys.exit(1)


if __name__ == "__main__":
    main()
