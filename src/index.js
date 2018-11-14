// @flow
import React, { Component } from 'react';
import Texture, {
  NearestFilter,
  LinearFilter,
  NearestMipMapNearestFilter,
  LinearMipMapNearestFilter,
  NearestMipMapLinearFilter,
  LinearMipMapLinearFilter,
  ClampToEdgeWrapping,
  MirroredRepeatWrapping,
  RepeatWrapping,
} from './Texture';

export {
  NearestFilter,
  LinearFilter,
  NearestMipMapNearestFilter,
  LinearMipMapNearestFilter,
  NearestMipMapLinearFilter,
  LinearMipMapLinearFilter,
  ClampToEdgeWrapping,
  MirroredRepeatWrapping,
  RepeatWrapping,
};

const FS_PRECISION_PREPROCESSOR = 
`#ifdef GL_ES
    precision mediump float;
#endif\n`;

const FS_MAIN_SHADER = 
`\nvoid main(void){
    vec4 color = vec4(0.0,0.0,0.0,1.0);
    mainImage( color, gl_FragCoord.xy );
    gl_FragColor = color;
}`;

const BASIC_FS = // Basic shadertoy shader
`void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
    vec2 uv = fragCoord/iResolution.xy;
    vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));
    fragColor = vec4(col,1.0);
}`;

const BASIC_VS = 
`attribute vec3 aVertexPosition;
void main(void) {
    gl_Position = vec4(aVertexPosition, 1.0);
}`;

const UNIFORM_TIME = 'iTime';
const UNIFORM_TIMEDELTA = 'iTimeDelta';
const UNIFORM_FRAME = 'iFrame';
const UNIFORM_MOUSE = 'iMouse';
const UNIFORM_RESOLUTION = 'iResolution';
const UNIFORM_CHANNEL = 'iChannel';
const UNIFORM_CHANNELRESOLUTION = 'iChannelResolution';

const builtInUniforms = {
  [UNIFORM_TIME]: {
    type: 'float',
    isNeeded: false,
    value: 0,
  },
  [UNIFORM_MOUSE]: {
    type: 'vec4',
    isNeeded: false,
    value: [0, 0, 0, 0],
  },
  [UNIFORM_RESOLUTION]: {
    type: 'vec2',
    isNeeded: false,
    value: [0, 0],
  },
  [UNIFORM_FRAME]: {
    type: 'int',
    isNeeded: false,
    value: 0,
  },
  [UNIFORM_TIMEDELTA]: {
    type: 'float',
    isNeeded: false,
    value: 0,
  },
};

/* eslint-disable */
type TexturePropsType = {
  url: string,
  wrapS?: number,
  wrapT?: number,
  minFilter?: number,
  magFilter?: number,
  flipY?: number,
};
/* eslint-emable */

type Props = {
  fs: string,
  vs?: string,
  textures?: Array<TexturePropsType>,
  customStyle?: string,
  contextOptions?: Object,
  devicePixelRatio?: number,
  onDoneLoadingTextures?: Function,
};

type Shaders = {
  fs: string,
  vs: string,
};

const lerp = (v0: number, v1: number, t: number) => v0 * (1 - t) + v1 * t;
const insertStringAtIndex = (
  currentString: string,
  string: string,
  index: number
) =>
  index > 0
    ? currentString.substring(0, index) +
      string +
      currentString.substring(index, currentString.length)
    : string + currentString;

export default class ShadertoyReact extends Component<Props, *> {

  static defaultProps = {
    textures: [],
    contextOptions: { premultipliedAlpha: false, alpha: true },
    devicePixelRatio: 1,
    vs: BASIC_VS,
  };

  componentDidMount = () => {
    this.initWebGL();

    const { fs, vs, textures, onDoneLoadingTextures } = this.props;
    const { gl } = this;

    if (gl) {
      gl.clearColor(0.0, 0.0, 0.0, 1.0); // Clear to black, fully opaque
      gl.clearDepth(1.0); // Clear everything
      gl.enable(gl.DEPTH_TEST); // Enable depth testing
      gl.depthFunc(gl.LEQUAL); // Near things obscure far things
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      
      this.canvas.height = this.canvas.clientHeight;
      this.canvas.width = this.canvas.clientWidth;

      if (textures && textures.length > 0) {

        builtInUniforms[`${UNIFORM_CHANNELRESOLUTION}`] = {
          type: 'vec3',
          isNeeded: false,
          arraySize: `[${textures.length - 1}]`,
        };

        const texturePromisesArr = textures.map((texture: TexturePropsType, id: number) => {
          
          this.texturesResolution[id] = [0, 0, 0];

          builtInUniforms[`${UNIFORM_CHANNEL}${id}`] = {
            type: 'sampler2D',
            isNeeded: false,
          };

          this.textures[id] = new Texture(gl);
          return this.textures[id]
                  .load(texture, id)
                  .then(texture => this.setupChannelRes(texture, id));
        });

        Promise.all(texturePromisesArr)
          .then(() => {
            if (onDoneLoadingTextures) onDoneLoadingTextures();
          });
      }
      
      const shaders = this.preProcessShaders(fs || BASIC_FS, vs || BASIC_VS);
      this.initShaders(shaders);
      this.initBuffers();
      this.drawScene();
      this.addEventListeners();
      this.onResize();
      // this.timeoutId = setTimeout(() => this.onResize(), 500);
    }
  };

  shouldComponentUpdate = () => false;

  componentWillUnmount() {
    const { gl } = this;

    if(gl) {
      gl.getExtension('WEBGL_lose_context').loseContext();

      gl.useProgram(null);
      gl.deleteProgram(this.shaderProgram);

      if (this.textures.length > 0) {
        this.textures.forEach((texture) => {
          gl.deleteTexture(texture.webglTexture);
        });
      }

      this.shaderProgram = null;
    }

    this.removeEventListeners();
    clearTimeout(this.timeoutId);
    cancelAnimationFrame(this.animFrameId);
  }

  setupChannelRes = ({width, height}: Texture, id: number) => {
    this.texturesResolution[id] = [ width, height, 0 ];
  }

  initWebGL = () => {
    const { contextOptions } = this.props;
    // $FlowFixMe
    this.gl =
      this.canvas.getContext('webgl', contextOptions) ||
      this.canvas.getContext('experimental-webgl', contextOptions);
    // $FlowFixMe
    this.gl.getExtension('OES_standard_derivatives');
    // $FlowFixMe
    this.gl.getExtension('EXT_shader_texture_lod');
  };

  initBuffers = () => {
    const { gl } = this;

    this.squareVerticesBuffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, this.squareVerticesBuffer);

    const vertices = [
      1.0, 1.0, 0.0, 
      -1.0, 1.0, 0.0, 
      1.0, -1.0, 0.0, 
      -1.0, -1.0, 0.0,
    ];

    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(vertices),
      gl.STATIC_DRAW
    );
  };

  addEventListeners = () => {
    if (builtInUniforms.iMouse.isNeeded) {
      this.canvas.addEventListener('mousemove', this.mouseMove);
      this.canvas.addEventListener('mouseout', this.mouseUp);
      this.canvas.addEventListener('mouseup', this.mouseUp);
      this.canvas.addEventListener('mousedown', this.mouseDown);

      this.canvas.addEventListener('touchmove', this.mouseMove);
      this.canvas.addEventListener('touchend', this.mouseUp);
    }

    window.addEventListener('resize', this.onResize, { passive: true });
  };

  removeEventListeners = () => {
    if (builtInUniforms.iMouse.isNeeded) {
      this.canvas.removeEventListener('mousemove', this.mouseMove);
      this.canvas.removeEventListener('mouseout', this.mouseUp);
      this.canvas.removeEventListener('mouseup', this.mouseUp);
      this.canvas.removeEventListener('mousedown', this.mouseDown);

      this.canvas.removeEventListener('touchmove', this.mouseMove);
      this.canvas.removeEventListener('touchend', this.mouseUp);
    }

    window.removeEventListener('resize', this.onResize, { passive: true });
  };

  mouseDown = e => {
    this.canvasPosition = this.canvas.getBoundingClientRect();

    let mouseX = (e.clientX || e.touches[0].clientX) - this.canvasPosition.left;
    let mouseY = (this.canvasPosition.height - (e.clientY || e.touches[0].clientY)) - this.canvasPosition.top;

    this.mousedown = true;
    this.iMouse[2] = mouseX;
    this.iMouse[3] = mouseY;
  }

  mouseMove = e => {
    if (!this.mousedown) return;
    
    let mouseX = (e.clientX || e.touches[0].clientX) - this.canvasPosition.left;
    let mouseY = (this.canvasPosition.height - (e.clientY || e.touches[0].clientY)) - this.canvasPosition.top;

    this.iMouse[0] = mouseX;
    this.iMouse[1] = mouseY;
  }

  mouseUp = e => {
    this.mousedown = false;
    this.iMouse[2] = 0;
    this.iMouse[3] = 0;
  }

  onResize = () => {
    const { gl } = this;
    const { devicePixelRatio = 1 } = this.props;
    this.canvasPosition = this.canvas.getBoundingClientRect();

    const realToCSSPixels = devicePixelRatio; // Force pixel ratio to be one to avoid expensive calculus on retina display

    const displayWidth = Math.floor(
      this.canvasPosition.width * realToCSSPixels
    );
    const displayHeight = Math.floor(
      this.canvasPosition.height * realToCSSPixels
    );

    gl.canvas.width = displayWidth;
    gl.canvas.height = displayHeight;

    if (builtInUniforms.iResolution.isNeeded) {
      const rUniform = gl.getUniformLocation(
        this.shaderProgram,
        UNIFORM_RESOLUTION
      );
      // $FlowFixMe
      gl.uniform2fv(rUniform, [
        gl.canvas.width,
        gl.canvas.height,
      ]);
    }
  };

  drawScene = (timestamp: number) => {
    const { gl } = this;
    
    gl.viewport(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight
    );

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); // eslint-disable-line no-bitwise

    gl.bindBuffer(gl.ARRAY_BUFFER, this.squareVerticesBuffer);
    gl.vertexAttribPointer(
      this.vertexPositionAttribute,
      3,
      gl.FLOAT,
      false,
      0,
      0
    );

    this.setUniforms(timestamp);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // if (builtInUniforms.iMouse.isNeeded) {
    //   this.iMouse[0] = lerp(this.iMouse[0], this.mouseX, 0.1);
    //   this.iMouse[1] = lerp(this.iMouse[1], this.mouseY, 0.1);
    // }

    this.animFrameId = requestAnimationFrame(this.drawScene);
  };

  createShader = (type: number, shaderCodeAsText: string) => {
    const { gl } = this;

    const shader = gl.createShader(type);

    gl.shaderSource(shader, shaderCodeAsText);
    gl.compileShader(shader);

    /* eslint-disable no-console */
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Error compiling the shader:', shaderCodeAsText);
      const compilationLog = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      console.error(`Shader compiler log: ${compilationLog}`);
    }
    /* eslint-enable no-console */

    return shader;
  };

  initShaders = ({ fs, vs }: Shaders) => {
    const { gl } = this;
    // console.log(fs, vs);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fs);
    const vertexShader = this.createShader(gl.VERTEX_SHADER, vs);

    this.shaderProgram = gl.createProgram();
    gl.attachShader(this.shaderProgram, vertexShader);
    gl.attachShader(this.shaderProgram, fragmentShader);
    gl.linkProgram(this.shaderProgram);

    /* eslint-disable no-console */
    if (!gl.getProgramParameter(this.shaderProgram, gl.LINK_STATUS)) {
      // $FlowFixMe
      console.error(
        `Unable to initialize the shader program: ${gl.getProgramInfoLog(
          this.shaderProgram
        )}`
      );
      return;
    }
    /* eslint-enable no-console */

    gl.useProgram(this.shaderProgram);

    this.vertexPositionAttribute = gl.getAttribLocation(
      this.shaderProgram,
      'aVertexPosition'
    );
    gl.enableVertexAttribArray(this.vertexPositionAttribute);
  };

  preProcessShaders = (fs: string, vs: string) => {
    let fsString = FS_PRECISION_PREPROCESSOR
                    .concat(fs)
                    .replace(/texture\(/g, 'texture2D(');

    const lastPreprocessorString = '#endif';
    const index = fsString.lastIndexOf(lastPreprocessorString);
    Object.keys(builtInUniforms).forEach((uniform: string) => {
      if (fs.includes(uniform)) {
        fsString = insertStringAtIndex(
          fsString,
          `uniform ${builtInUniforms[uniform].type} ${uniform}${builtInUniforms[uniform].arraySize || ''}; \n`,
          index + lastPreprocessorString.length + 1
        );
        builtInUniforms[uniform].isNeeded = true;
      }
    });
    fsString = fsString.concat(FS_MAIN_SHADER);
    console.log(fsString);
    return { fs: fsString, vs };
  };

  setUniforms = (timestamp: number) => {

    const { gl } = this;
    
    let delta = this.lastTime ? ((timestamp - this.lastTime) / 1000) : 0;
    this.lastTime = timestamp;

    if (builtInUniforms.iMouse.isNeeded) {
      const mouseUniform = gl.getUniformLocation(
        this.shaderProgram,
        UNIFORM_MOUSE
      );
      // $FlowFixMe
      gl.uniform4fv(mouseUniform, [this.iMouse[0], this.iMouse[1], this.iMouse[2], this.iMouse[3] ]);
    }
    
    if(builtInUniforms.iChannelResolution.isNeeded && this.texturesResolution.length > 0){
      const channelResUniform = gl.getUniformLocation(
        this.shaderProgram,
        UNIFORM_CHANNELRESOLUTION
      );
      gl.uniform3fv(channelResUniform, this.texturesResolution.flat());
    }

    if (builtInUniforms.iTime.isNeeded) {
      const timeUniform = gl.getUniformLocation(
        this.shaderProgram,
        UNIFORM_TIME
      );
      gl.uniform1f(timeUniform, this.timer += delta );
    }

    if (builtInUniforms.iTimeDelta.isNeeded) {
      const timeDeltaUniform = gl.getUniformLocation(
        this.shaderProgram,
        UNIFORM_TIMEDELTA
      );
      gl.uniform1f(timeUniform, delta );
    }

    if (builtInUniforms.iFrame.isNeeded) {
      const timeDeltaUniform = gl.getUniformLocation(
        this.shaderProgram,
        UNIFORM_FRAME
      );
      gl.uniform1f(timeUniform, this.frame++ );
    }

    if (this.textures.length > 0) {
      this.textures.forEach((texture: Texture, id: number) => {
        const {isVideo, _webglTexture, source, flipY, isLoaded} = texture;
        if(!isLoaded) return;
        if (builtInUniforms[`iChannel${id}`].isNeeded) {
          const iChannel = gl.getUniformLocation(
            this.shaderProgram,
            `iChannel${id}`
          );
          gl.activeTexture(gl[`TEXTURE${id}`]);
          gl.bindTexture(gl.TEXTURE_2D, _webglTexture);
          gl.uniform1i(iChannel, id); 
          if(isVideo) texture.updateTexture(_webglTexture, source, flipY);          
        }
      });
    }
  };

  registerCanvas = (r: HTMLCanvasElement) => {
    this.canvas = r;
  };

  gl: WebGLRenderingContext;
  squareVerticesBuffer: WebGLBuffer;
  shaderProgram: WebGLProgram;
  vertexPositionAttribute: number;
  animFrameId: AnimationFrameID;
  timeoutId: TimeoutID;
  canvas: HTMLCanvasElement;
  pow2canvas: HTMLCanvasElement;
  iMouse: Array<number> = [4];
  mousedown: boolean = false;
  mouseX: number = 0;
  mouseY: number = 0;
  canvasPosition: Object = {};
  timer: number = 0;
  textures: Array<WebGLTexture> = [];
  texturesResolution: Array<> = [];
  lastTime: number = 0;
  frame: number = 0;

  render = () => {
    const { style } = this.props;

    const currentStyle = {
        glCanvas: {
          position: 'absolute',
          height: '100%',
          width: '100%',
          ...style,
        }
    };

    return (
      <canvas style={currentStyle.glCanvas} ref={this.registerCanvas} />
    );
  };
}