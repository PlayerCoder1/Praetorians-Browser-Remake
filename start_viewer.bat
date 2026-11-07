@echo off
setlocal
cd /d "%~dp0"
set "PRAETORIANS_PYTHON="
set "PRAETORIANS_PYTHON_ARGS="
for %%V in (314 313 312 311 310) do if not defined PRAETORIANS_PYTHON if exist "%LocalAppData%\Programs\Python\Python%%V\python.exe" set "PRAETORIANS_PYTHON=%LocalAppData%\Programs\Python\Python%%V\python.exe"
if not defined PRAETORIANS_PYTHON (
 python -c "import sys" >nul 2>&1
 if not errorlevel 1 set "PRAETORIANS_PYTHON=python"
)
if not defined PRAETORIANS_PYTHON (
 py -3 -c "import sys" >nul 2>&1
 if not errorlevel 1 (
  set "PRAETORIANS_PYTHON=py"
  set "PRAETORIANS_PYTHON_ARGS=-3"
 )
)
if not defined PRAETORIANS_PYTHON (
 echo Python 3 is required. Install it from python.org.
 pause
 exit /b 1
)
if "%~1"=="--rebuild" goto rebuild
if "%~1"=="--rebuild-hd" goto rebuild_hd
if "%~1"=="--rebuild-maps" goto rebuild_maps
if not exist assets\tutorial1.json goto rebuild
if not exist assets\hd\environment\models.json goto rebuild_hd
if not exist assets\hd\environment\terrain.bin goto rebuild_hd
if not exist assets\hd\environment\structures.json goto rebuild_hd
if not exist assets\hd\units\units.json goto rebuild_hd
if not exist assets\hd\units\combat\infantry.json goto rebuild_hd
if not exist assets\hd\units\combat\gaul_infantry.json goto rebuild_hd
if not exist assets\hd\interface\manifest.json goto rebuild_hd
if not exist assets\hd\units\combat\scout.json goto rebuild_hd
if not exist assets\hd\units\combat\hawk.json goto rebuild_hd
if not exist assets\hd\units\combat\deer.json goto rebuild_hd
if not exist assets\hd\sounds\manifest.json goto rebuild_hd
if not exist assets\hd\sounds\voice_fr_0110.ogg goto rebuild_hd
if not exist assets\hd\sounds\voice_fr_IRTK_1.ogg goto rebuild_hd
if not exist data\localization\fr-game.json goto rebuild_hd
if not exist data\localization\languages.json goto rebuild_hd
if not exist data\game\special-formations.json goto rebuild_maps
if not exist data\localization\en-game.json goto rebuild_hd
if not exist assets\maps\catalog.json goto rebuild_maps
if not exist assets\missions\SP_TUTORIAL_2.json goto rebuild_maps
if not exist assets\maps\SP_TUTORIAL_2\terrain.bin goto rebuild_maps
if not exist assets\hd\objects\index.json goto rebuild_maps
if not exist assets\hd\units\combat\types.json goto rebuild_maps
if not exist assets\hd\units\combat\pge_lobo.json goto rebuild_maps
if not exist assets\hd\units\combat\pge_lobo.bin goto rebuild_maps
if not exist assets\hd\structures.json goto rebuild_maps
goto serve

:rebuild
echo Reading Tutorial 1 mission data and object transforms from Content\DATA...
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\build_assets.py
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\collect_original_models.py
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\convert_original_models.py
if errorlevel 1 goto failed

:rebuild_hd
if not exist assets\tutorial1.json goto rebuild
if not exist assets\models\models.json goto rebuild
if not exist Content\Paks\pakchunk0-WindowsNoEditor.pak (
 echo The HD Remaster archive is required in Content\Paks.
 goto failed
)
if not exist tools\vendor\umodel\umodel_64.exe (
 echo Official UE Viewer is required at tools\vendor\umodel\umodel_64.exe.
 goto failed
)
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% -c "import PIL" >nul 2>&1
if errorlevel 1 (
 echo Install Pillow: "%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% -m pip install Pillow
 goto failed
)
echo Exporting actual HD meshes, textures, vertex animations and TorusUI from Content\Paks...
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_environment.py
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_meadows.py
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_structures.py
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_units.py
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_combat_units.py
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_interface.py
if errorlevel 1 goto failed
echo Extracting sounds, music, the French voices and the French game texts...
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_sounds.py --voices
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_texts.py --all
if errorlevel 1 goto failed

:rebuild_maps
rem Every campaign mission and skirmish map: mission files, maps, the HD
rem terrain and object library, the whole army, structures and game data.
if not exist Content\Paks\pakchunk0-WindowsNoEditor.pak (
 echo The HD Remaster archive is required in Content\Paks.
 goto failed
)
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% -c "import numpy, PIL" >nul 2>&1
if errorlevel 1 (
 echo Install NumPy and Pillow: "%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% -m pip install numpy Pillow
 goto failed
)
where node >nul 2>&1
if errorlevel 1 (
 echo Node.js is required to build the game data tables.
 goto failed
)
echo Reading every campaign mission and skirmish map from Content\DATA...
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\build_maps.py
if errorlevel 1 goto failed
node tools\build_game_data.js
if errorlevel 1 goto failed
node tools\build_special_formations.js
if errorlevel 1 goto failed
echo Exporting the HD terrain of every map and the object library (this takes a while)...
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_maps.py
if errorlevel 1 goto failed
echo Exporting the whole army and every mission structure...
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_army.py
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_team_colours.py
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_buildings.py
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_troop_tents.py
if errorlevel 1 goto failed
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_machine_sites.py
if errorlevel 1 goto failed

:serve
if not exist assets\hd\machine-sites.json (
 echo Exporting the siege machines' building sites...
 "%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_machine_sites.py
)
if not exist assets\menu-original\Game\GUI\Menus\Graficos\PlayerWin0.png (
 echo Exporting the results screen banners...
 "%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\export_hd_results_art.py
)
if not exist assets\menu\catalog.json (
 echo Building local mission and multiplayer map menu catalog...
 "%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\build_menu_catalog.py
)
if not exist assets\vendor\babylon.js (
 echo Missing local Babylon.js engine: assets\vendor\babylon.js
 goto failed
)
if not exist src\navigation\terrain-nav.js goto failed
if not exist src\units\squad-motion.js goto failed
if "%~1"=="--check" (
 echo HD Remaster assets and launcher are ready.
 exit /b 0
)
echo Opening Praetorians HD Remaster at http://127.0.0.1:8000
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% -c "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8000',timeout=1); sys.exit(0 if b'Praetorians HD Remaster' in r.read() else 1)" >nul 2>&1
if not errorlevel 1 (
 start "" "http://127.0.0.1:8000"
 exit /b 0
)
start "" "http://127.0.0.1:8000"
"%PRAETORIANS_PYTHON%" %PRAETORIANS_PYTHON_ARGS% tools\serve.py 8000
exit /b

:failed
echo Failed to start. Your PAK archives have NOT been modified.
pause
exit /b 1
