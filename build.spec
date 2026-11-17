# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 打包配置脚本 (onefile 单文件模式)。
用于将 FastAPI 应用打包为单个 Windows EXE 文件。

使用方法：
    pip install pyinstaller
    python build_exe.py

产物位置：dist/WeatherForecast.exe
"""

block_cipher = None

# 1. 数据文件：仅包含必要的静态资源 (HTML, CSS, JS)
datas = [
    ('static', 'static'),
]

# 2. Hidden Imports：所有可能被动态导入的模块
hiddenimports = [
    # === uvicorn 核心 ===
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    # === fastapi / starlette ===
    'fastapi',
    'fastapi.middleware',
    'fastapi.middleware.cors',
    'fastapi.responses',
    'starlette',
    'starlette.routing',
    'starlette.responses',
    'starlette.middleware',
    'starlette.middleware.cors',
    'starlette.staticfiles',
    'starlette.templating',
    # === httpx / httpcore ===
    'httpx',
    'httpx._config',
    'httpx._models',
    'httpx._transports',
    'httpx._transports.default',
    'httpx._transports.async',
    'httpx._decoders',
    'httpx._exceptions',
    'httpx._content',
    'httpcore',
    'httpcore.async',
    'httpcore.sync',
    # === pydantic ===
    'pydantic',
    'pydantic.deprecated',
    'annotated_types',
    # === app 包 ===
    'app',
    'app.main',
    'app.config',
    'app.api',
    'app.api.routes',
    'app.models',
    'app.models.schemas',
    'app.services',
    'app.services.cache',
    'app.services.cma',
    'app.services.elevation',
    'app.services.ensemble',
    'app.services.open_meteo',
    'app.services.snow',
    'app.services.stargazing',
    'app.services.typhoon',
    'app.services.air_quality',
    'app.services.light_pollution',
]

# 3. 排除模块：仅排除确定不需要的第三方大库
excludes = [
    # 大型科学/数据可视化库
    'matplotlib',
    'numpy',
    'pandas',
    'scipy',
    'sympy',
    'Cython',
    'h5py',
    'tables',
    'netCDF4',
    # 图像处理库
    'PIL',
    'Pillow',
    # GUI 框架
    'PyQt5',
    'PyQt6',
    'PySide2',
    'PySide6',
    'wx',
    # 浏览器自动化
    'selenium',
    'playwright',
    'pyppeteer',
    # 数据库 ORM
    'MySQLdb',
    'psycopg2',
    'sqlalchemy',
    # 开发/测试工具
    'IPython',
    'ipython',
    'jupyter',
    'notebook',
    'sphinx',
    'pytest',
    'unittest',
    'doctest',
    'difflib',
    'lib2to3',
    'py_compile',
    'pyclbr',
    'test',
    'tests',
    'setuptools',
    'pip',
    'wheel',
    # 可选标准库
    'curses',
    'pty',
    'readline',
    'rlcompleter',
    'shelve',
    'dbm',
    'turtle',
    'turtledemo',
    'venv',
    'ensurepip',
    'idlelib',
]

# === Analysis 阶段 ===
a = Analysis(
    ['run.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# === onefile 模式：所有内容打包到单个 EXE ===
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='WeatherForecast',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=True,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
