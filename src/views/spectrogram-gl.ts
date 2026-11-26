/**
 * Draws spectrogram columns with WebGL. Analysed columns stay on the GPU as
 * intensities, so a redraw only uploads the ones that are new and colours the
 * rest where they are. One context serves every spectrogram — browsers allow
 * only a handful — and each drawing is copied to the canvas it belongs on.
 */

/** Columns per texture; each column is one texture row, so it uploads alone. */
const CHUNK_COLUMNS = 256;

const VERTEX_SHADER = `#version 300 es
void main() {
	// One triangle covering the viewport.
	gl_Position = vec4(
		gl_VertexID == 1 ? 3.0 : -1.0,
		gl_VertexID == 2 ? 3.0 : -1.0,
		0.0,
		1.0
	);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uIntensities;
uniform vec3 uBackground;
uniform vec3 uColor;
/** Chunk column minus canvas column. */
uniform int uColumnOffset;
/** One past the lane's top row, counted from the bottom of the framebuffer. */
uniform int uLaneTop;
out vec4 outColor;
void main() {
	float intensity = texelFetch(
		uIntensities,
		ivec2(
			uLaneTop - 1 - int(gl_FragCoord.y),
			int(gl_FragCoord.x) + uColumnOffset
		),
		0
	).r;
	outColor = vec4(mix(uBackground, uColor, intensity), 1.0);
}`;

interface ColumnChunk {
	texture: WebGLTexture;
	/** Which of the columns come from the mix the store holds now. */
	current: Uint8Array;
}

/**
 * The columns of one lane already analysed, by their index on the surface.
 * Those of the mix shown before, at the same geometry, stay in their textures
 * until the current one replaces them — so a dragged volume slider does not
 * blank the view on every step.
 */
export interface SpectrogramColumnCache {
	renderer: SpectrogramRenderer;
	key: string;
	geometryKey: string;
	rows: number;
	chunks: Map<number, ColumnChunk>;
}

/** One lane of a drawing, placed in device-pixel rows from the top. */
export interface SpectrogramLanePlacement {
	cache: SpectrogramColumnCache;
	top: number;
}

export type Rgb = [number, number, number];

export class SpectrogramRenderer {
	private readonly canvas = document.createElement("canvas");
	private readonly gl: WebGL2RenderingContext;
	private readonly uniforms: {
		background: WebGLUniformLocation | null;
		color: WebGLUniformLocation | null;
		columnOffset: WebGLUniformLocation | null;
		laneTop: WebGLUniformLocation | null;
	};

	constructor() {
		const gl = this.canvas.getContext("webgl2", {
			alpha: false,
			antialias: false,
			depth: false,
		});
		if (!gl) {
			throw new Error("Spectrograms need WebGL 2.");
		}
		this.gl = gl;

		const program = gl.createProgram();
		for (const [type, source] of [
			[gl.VERTEX_SHADER, VERTEX_SHADER],
			[gl.FRAGMENT_SHADER, FRAGMENT_SHADER],
		] as const) {
			const shader = gl.createShader(type) as WebGLShader;
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			gl.attachShader(program, shader);
		}
		gl.linkProgram(program);
		if (
			!gl.getProgramParameter(program, gl.LINK_STATUS) &&
			!gl.isContextLost()
		) {
			throw new Error(
				`Spectrogram shader failed: ${gl.getProgramInfoLog(program)}`,
			);
		}
		// biome-ignore lint/correctness/useHookAtTopLevel: WebGL, not a React hook.
		gl.useProgram(program);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		this.uniforms = {
			background: gl.getUniformLocation(program, "uBackground"),
			color: gl.getUniformLocation(program, "uColor"),
			columnOffset: gl.getUniformLocation(program, "uColumnOffset"),
			laneTop: gl.getUniformLocation(program, "uLaneTop"),
		};
	}

	/** True once the browser has dropped the context and every texture with it. */
	get isLost(): boolean {
		return this.gl.isContextLost();
	}

	createCache(
		key: string,
		geometryKey: string,
		rows: number,
	): SpectrogramColumnCache {
		return { renderer: this, key, geometryKey, rows, chunks: new Map() };
	}

	/** Marks every column as left over from an earlier mix. */
	expireColumns(cache: SpectrogramColumnCache): void {
		cache.chunks.forEach((chunk) => {
			chunk.current.fill(0);
		});
	}

	hasColumn(cache: SpectrogramColumnCache, index: number): boolean {
		const chunk = cache.chunks.get(Math.floor(index / CHUNK_COLUMNS));
		return chunk?.current[index % CHUNK_COLUMNS] === 1;
	}

	/** Uploads the intensities of one column, top row first. */
	setColumn(
		cache: SpectrogramColumnCache,
		index: number,
		intensities: Uint8Array,
	): void {
		const { gl } = this;
		const chunkIndex = Math.floor(index / CHUNK_COLUMNS);
		let chunk = cache.chunks.get(chunkIndex);
		if (chunk) {
			gl.bindTexture(gl.TEXTURE_2D, chunk.texture);
		} else {
			// Starts out zeroed, which is what the background is drawn from.
			const texture = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, cache.rows, CHUNK_COLUMNS);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			chunk = { texture, current: new Uint8Array(CHUNK_COLUMNS) };
			cache.chunks.set(chunkIndex, chunk);
		}
		gl.texSubImage2D(
			gl.TEXTURE_2D,
			0,
			0,
			index % CHUNK_COLUMNS,
			cache.rows,
			1,
			gl.RED,
			gl.UNSIGNED_BYTE,
			intensities,
		);
		chunk.current[index % CHUNK_COLUMNS] = 1;
	}

	/** Frees the textures holding no column of [`start`, `end`). */
	pruneColumns(
		cache: SpectrogramColumnCache,
		start: number,
		end: number,
	): void {
		cache.chunks.forEach((chunk, chunkIndex) => {
			const first = chunkIndex * CHUNK_COLUMNS;
			if (first + CHUNK_COLUMNS <= start || first >= end) {
				this.gl.deleteTexture(chunk.texture);
				cache.chunks.delete(chunkIndex);
			}
		});
	}

	deleteCache(cache: SpectrogramColumnCache): void {
		cache.chunks.forEach((chunk) => {
			this.gl.deleteTexture(chunk.texture);
		});
		cache.chunks.clear();
	}

	/**
	 * Draws `drawColumns` columns of each lane, from surface column
	 * `firstColumn` on, over a `width` × `height` background. Returns the canvas
	 * holding the drawing in its top-left corner, which the next call overwrites.
	 */
	draw(
		width: number,
		height: number,
		lanes: SpectrogramLanePlacement[],
		firstColumn: number,
		drawColumns: number,
		background: Rgb,
		color: Rgb,
	): HTMLCanvasElement {
		const { gl, canvas, uniforms } = this;
		// Only ever grows: resizing reallocates the framebuffer.
		if (canvas.width < width) {
			canvas.width = width;
		}
		if (canvas.height < height) {
			canvas.height = height;
		}

		const [red, green, blue] = background.map((value) => value / 255);
		gl.clearColor(red, green, blue, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.uniform3f(uniforms.background, red, green, blue);
		gl.uniform3f(
			uniforms.color,
			color[0] / 255,
			color[1] / 255,
			color[2] / 255,
		);

		const end = firstColumn + drawColumns;
		lanes.forEach(({ cache, top }) => {
			const laneTop = canvas.height - top;
			gl.uniform1i(uniforms.laneTop, laneTop);
			cache.chunks.forEach((chunk, chunkIndex) => {
				const chunkStart = chunkIndex * CHUNK_COLUMNS;
				const from = Math.max(firstColumn, chunkStart);
				const to = Math.min(end, chunkStart + CHUNK_COLUMNS);
				if (to <= from) {
					return;
				}
				gl.bindTexture(gl.TEXTURE_2D, chunk.texture);
				gl.uniform1i(uniforms.columnOffset, firstColumn - chunkStart);
				gl.viewport(
					from - firstColumn,
					laneTop - cache.rows,
					to - from,
					cache.rows,
				);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			});
		});
		return canvas;
	}
}

let sharedRenderer: SpectrogramRenderer | null = null;

/** The renderer every spectrogram draws with, replaced once its context is lost. */
export function getSpectrogramRenderer(): SpectrogramRenderer {
	if (!sharedRenderer || sharedRenderer.isLost) {
		sharedRenderer = new SpectrogramRenderer();
	}
	return sharedRenderer;
}
