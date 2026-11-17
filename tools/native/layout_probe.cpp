#include "mini_titleformat.h"
#include "core/script_runtime.h"
#include <fstream>
#include <iterator>
#include <iostream>
int main(int argc,char**argv) {
 if(argc<4)return 2;
 std::ifstream f(argv[1]);std::string s((std::istreambuf_iterator<char>(f)),{});
 t::RecordingCanvas canvas;
 t::MiniTf env(canvas.ops);
 pui::ScriptState state;
 for(int i=4;i<argc;i++){std::string a=argv[i];auto p=a.find('=');if(p!=std::string::npos)state.pvars[a.substr(0,p)]=a.substr(p+1);}
 pui::ScriptRuntime rt(state,env,canvas,std::stoi(argv[2]),std::stoi(argv[3]));env.render(rt,s);
 for(const auto&p:state.placements) std::cout<<p.name<<'\t'<<p.type<<'\t'<<p.x<<'\t'<<p.y<<'\t'<<p.w<<'\t'<<p.h<<'\n';
 for(const auto&e:env.reports)std::cerr<<e<<'\n';
 return env.reports.empty()?0:1;
}
